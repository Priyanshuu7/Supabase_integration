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

export default authenticateUser;