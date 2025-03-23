import express from 'express';
import {createClient} from '@supabase/supabase-js';
import {PrismaClient} from '@prisma/client';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;
const prisma = new PrismaClient();

// Initialize Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Middleware to parse JSON bodies
app.use(express.json());

// Add this middleware function after your existing imports and before routes
const authenticateUser = async(req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        if (!authHeader) {
            return res
                .status(401)
                .json({error: 'No authorization header'});
        }

        const token = authHeader.split(' ')[1];
        if (!token) {
            return res
                .status(401)
                .json({error: 'No token provided'});
        }

        const {data: {
                user
            }, error} = await supabase
            .auth
            .getUser(token);

        if (error) {
            return res
                .status(401)
                .json({error: 'Invalid token'});
        }

        // Add user to request object
        req.user = user;
        next();
    } catch (error) {
        res
            .status(401)
            .json({error: 'Authentication failed'});
    }
};

// Sign up endpoint
app.post('/signup', async(req, res) => {
    try {
        const {email, password} = req.body;

        // Create user in Supabase Auth
        const {data: authData, error: authError} = await supabase
            .auth
            .signUp({email, password});

        if (authError) 
            throw authError;
        
        // Create user in Prisma database
        const user = await prisma
            .user
            .create({
                data: {
                    id: authData.user.id, // Use Supabase user ID
                    email: email
                }
            });

        res.json({
            success: true,
            user: {
                ...user,
                auth: authData.user
            }
        });
    } catch (error) {
        res
            .status(500)
            .json({success: false, error: error.message});
    }
});

// Sign in endpoint
app.post('/signin', async(req, res) => {
    try {
        const {email, password} = req.body;

        const {data: authData, error: authError} = await supabase
            .auth
            .signInWithPassword({email, password});

        if (authError) 
            throw authError;
        
        // Get user from database or create if doesn't exist
        let user = await prisma
            .user
            .findUnique({
                where: {
                    id: authData.user.id
                }
            });

        if (!user) {
            user = await prisma
                .user
                .create({
                    data: {
                        id: authData.user.id,
                        email: email
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
        res
            .status(500)
            .json({success: false, error: error.message});
    }
});

// Add the protected post creation route
app.post('/post', authenticateUser, async(req, res) => {
    try {
        const {title, content} = req.body;

        // Validate input
        if (!title || !content) {
            return res
                .status(400)
                .json({success: false, error: 'Title and content are required'});
        }

        // Create post in database
        const post = await prisma
            .post
            .create({
                data: {
                    title,
                    content,
                    authorId: req.user.id, // Link post to authenticated user
                }
            });

        res.json({success: true, post});
    } catch (error) {
        res
            .status(500)
            .json({success: false, error: error.message});
    }
});

// Add the protected comment creation route
app.post('/comment', authenticateUser, async(req, res) => {
    try {
        const {content, postId} = req.body;

        // Validate input
        if (!content || !postId) {
            return res
                .status(400)
                .json({success: false, error: 'Content and postId are required'});
        }

        // Check if post exists
        const post = await prisma
            .post
            .findUnique({
                where: {
                    id: postId
                }
            });

        if (!post) {
            return res
                .status(404)
                .json({success: false, error: 'Post not found'});
        }

        // Create comment in database
        const comment = await prisma
            .comment
            .create({
                data: {
                    content,
                    authorId: req.user.id, // Link comment to authenticated user
                    postId, // Link comment to post
                },
                include: {
                    author: {
                        select: {
                            email: true
                        }
                    },
                    post: {
                        select: {
                            title: true
                        }
                    }
                }
            });

        res.json({success: true, comment});
    } catch (error) {
        res
            .status(500)
            .json({success: false, error: error.message});
    }
});

// Graceful shutdown
process.on('SIGINT', async() => {
    await Promise.all([
        prisma.$disconnect(),
        supabase
            .auth
            .signOut()
    ]);
    process.exit();
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
