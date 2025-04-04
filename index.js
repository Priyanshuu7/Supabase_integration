// Import required dependencies
import express from 'express';
import {createClient} from '@supabase/supabase-js';
import {PrismaClient} from '@prisma/client';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize Express app and set port
const app = express();
const prisma = new PrismaClient();

// Initialize Supabase clients - one for regular auth and one for admin operations
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Enable JSON parsing middleware
app.use(express.json());

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

        req.user = user;
        next();
    } catch (error) {
        res
            .status(401)
            .json({error: 'Authentication failed'});
    }
};

/**
 * User signup endpoint
 * Creates new user in both Supabase and Prisma
 */
app.post('/signup', async(req, res) => {
    try {
        const {email, password} = req.body;

        // Check if user exists in Supabase
        const {data: existingUser} = await supabase
            .auth
            .admin
            .listUsers({filters: {
                    email
                }});

        if (existingUser
            ?.length > 0) {
            return res
                .status(400)
                .json({success: false, error: 'User already exists with this email. Please login instead.'});
        }

        // Check if user exists in Prisma
        const existingPrismaUser = await prisma
            .user
            .findUnique({where: {
                    email
                }});

        if (existingPrismaUser) {
            return res
                .status(400)
                .json({success: false, error: 'User already exists with this email. Please login instead.'});
        }

        // Create user in Supabase
        const {data: authData, error: authError} = await supabase
            .auth
            .signUp({email, password});

        if (authError) 
            throw authError;
        
        // Create user in Prisma
        const user = await prisma
            .user
            .create({
                data: {
                    id: authData.user.id,
                    email
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

/**
 * User signin endpoint
 * Authenticates user and returns session data
 */
app.post('/signin', async(req, res) => {
    try {
        const {email, password} = req.body;

        const {data: authData, error: authError} = await supabase
            .auth
            .signInWithPassword({email, password});

        if (authError) 
            throw authError;
        
        // Find or create user in Prisma
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
                        email
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

/**
 * Create post endpoint
 * Requires authentication
 */
app.post('/post', authenticateUser, async(req, res) => {
    try {
        const {title, content} = req.body;

        if (!title || !content) {
            return res
                .status(400)
                .json({success: false, error: 'Title and content are required'});
        }

        const post = await prisma
            .post
            .create({
                data: {
                    title,
                    content,
                    authorId: req.user.id
                }
            });

        res.json({success: true, post});
    } catch (error) {
        res
            .status(500)
            .json({success: false, error: error.message});
    }
});

/**
 * Create comment endpoint
 * Requires authentication
 */
app.post('/comment', authenticateUser, async(req, res) => {
    try {
        const {content, postId} = req.body;

        if (!content || !postId) {
            return res
                .status(400)
                .json({success: false, error: 'Content and postId are required'});
        }

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

        const comment = await prisma
            .comment
            .create({
                data: {
                    content,
                    authorId: req.user.id,
                    postId
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

/**
 * Get post by ID endpoint
 * Returns post with author and comments
 */
app.get('/post/:id', async(req, res) => {
    try {
        const postId = req.params.id;

        const post = await prisma
            .post
            .findUnique({
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
            return res
                .status(404)
                .json({success: false, error: 'Post not found'});
        }

        res.json({success: true, post});
    } catch (error) {
        res
            .status(500)
            .json({success: false, error: error.message});
    }
});

/**
 * Admin endpoint to list all users
 * Requires authentication and admin privileges
 */
app.get('/admin/users', authenticateUser, async(req, res) => {
    try {
        const adminEmails = ['rajakronaldo@gmail.com'];
        if (!adminEmails.includes(req.user.email)) {
            return res
                .status(403)
                .json({success: false, error: 'Unauthorized: Admin access required'});
        }

        const {data: supabaseUsers, error: supabaseError} = await supabaseAdmin
            .auth
            .admin
            .listUsers();

        if (supabaseError) 
            throw supabaseError;
        
        const prismaUsers = await prisma
            .user
            .findMany();

        res.json({
            success: true,
            data: {
                supabaseUsers: supabaseUsers.users,
                prismaUsers,
                totalUsers: supabaseUsers.users.length,
                userEmails: supabaseUsers
                    .users
                    .map(user => user.email)
            }
        });

    } catch (error) {
        res
            .status(500)
            .json({success: false, error: error.message});
    }
});

/**
 * Admin endpoint to get user details by email
 * Requires authentication and admin privileges
 */
app.get('/admin/user/:email', authenticateUser, async(req, res) => {
    try {
        const adminEmails = ['rajakronaldo@gmail.com'];
        if (!adminEmails.includes(req.user.email)) {
            return res
                .status(403)
                .json({success: false, error: 'Unauthorized: Admin access required'});
        }

        const userEmail = req.params.email;

        const {data: supabaseUsers, error: supabaseError} = await supabaseAdmin
            .auth
            .admin
            .listUsers({
                filters: {
                    email: userEmail
                }
            });

        if (supabaseError) 
            throw supabaseError;
        
        const prismaUser = await prisma
            .user
            .findUnique({
                where: {
                    email: userEmail
                },
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
                userActivity: prismaUser
                    ? {
                        totalPosts: prismaUser.posts.length,
                        totalComments: prismaUser.comments.length
                    }
                    : null
            }
        });

    } catch (error) {
        res
            .status(500)
            .json({success: false, error: error.message});
    }
});

// Handle graceful shutdown
process.on('SIGINT', async() => {
    await Promise.all([
        prisma.$disconnect(),
        supabase
            .auth
            .signOut()
    ]);
    process.exit();
});

// Start the server
app.listen(3001, () => {
    console.log('Server running on http://localhost:3001');
});