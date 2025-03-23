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
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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

        // First check if user exists in Supabase
        const { data: existingUser } = await supabase
            .auth
            .admin
            .listUsers({
                filters: { email }
            });

        if (existingUser?.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'User already exists with this email. Please login instead.'
            });
        }

        // Check if user exists in Prisma
        const existingPrismaUser = await prisma.user.findUnique({
            where: {
                email: email
            }
        });

        if (existingPrismaUser) {
            return res.status(400).json({
                success: false,
                error: 'User already exists with this email. Please login instead.'
            });
        }

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
                    id: authData.user.id,
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
            msg: "User signed in successfully",
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

// Get post details by ID route
app.get('/post/:id', async (req, res) => {
    try {
        const postId = req.params.id;

        const post = await prisma.post.findUnique({
            where: {
                id: postId
            },
            include: {
                author: {
                    select: {
                        id: true,
                        email: true
                    }
                },
                comments: {
                    include: {
                        author: {
                            select: {
                                id: true,
                                email: true
                            }
                        }
                    }
                }
            }
        });

        if (!post) {
            return res.status(404).json({
                success: false,
                error: 'Post not found'
            });
        }

        res.json({
            success: true,
            post
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Admin test endpoint - Get all users
app.get('/admin/users', authenticateUser, async (req, res) => {
    try {
        // First verify if requesting user is an admin
        const adminEmails = ['rajakronaldo@gmail.com']; // Store this in env or database in production
        if (!adminEmails.includes(req.user.email)) {
            return res.status(403).json({
                success: false,
                error: 'Unauthorized: Admin access required'
            });
        }

        // Get all users from Supabase
        const { data: supabaseUsers, error: supabaseError } = await supabaseAdmin
            .auth
            .admin
            .listUsers();

        if (supabaseError) throw supabaseError;

        // Get all users from Prisma
        const prismaUsers = await prisma.user.findMany();

        res.json({
            success: true,
            data: {
                supabaseUsers: supabaseUsers.users,
                prismaUsers,
                totalUsers: supabaseUsers.users.length,
                userEmails: supabaseUsers.users.map(user => user.email)
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Admin test endpoint - Get user details
app.get('/admin/user/:email', authenticateUser, async (req, res) => {
    try {
        // Verify admin
        const adminEmails = ['rajakronaldo@gmail.com'];
        if (!adminEmails.includes(req.user.email)) {
            return res.status(403).json({
                success: false,
                error: 'Unauthorized: Admin access required'
            });
        }

        const userEmail = req.params.email;

        // Get user from Supabase
        const { data: supabaseUsers, error: supabaseError } = await supabaseAdmin
            .auth
            .admin
            .listUsers({
                filters: { email: userEmail }
            });

        if (supabaseError) throw supabaseError;

        // Get user from Prisma
        const prismaUser = await prisma.user.findUnique({
            where: { email: userEmail },
            include: {
                posts: true,
                comments: true
            }
        });

        res.json({
            success: true,
            data: {
                supabaseUser: supabaseUsers[0] || null,
                prismaUser,
                userActivity: prismaUser ? {
                    totalPosts: prismaUser.posts.length,
                    totalComments: prismaUser.comments.length
                } : null
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
