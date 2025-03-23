import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;
const prisma = new PrismaClient();

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// Middleware to parse JSON bodies
app.use(express.json());

// Sign up endpoint
app.post('/signup', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Create user in Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.signUp({
            email,
            password,
        });

        if (authError) throw authError;

        // Create user in Prisma database
        const user = await prisma.user.create({
            data: {
                id: authData.user.id,  // Use Supabase user ID
                email: email,
            },
        });
        
        res.json({
            success: true,
            user: {
                ...user,
                auth: authData.user
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Sign in endpoint
app.post('/signin', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (authError) throw authError;

        // Get user from database or create if doesn't exist
        let user = await prisma.user.findUnique({
            where: { id: authData.user.id }
        });

        if (!user) {
            user = await prisma.user.create({
                data: {
                    id: authData.user.id,
                    email: email,
                }
            });
        }
        
        res.json({
            success: true,
            session: authData.session,
            user: {
                ...user,
                auth: authData.user
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Graceful shutdown
process.on('SIGINT', async () => {
    await Promise.all([
        prisma.$disconnect(),
        supabase.auth.signOut()
    ]);
    process.exit();
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
