const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth2').Strategy;
require('dotenv').config();

// Verificar que las variables de entorno estén definidas
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.error('Error: Variables de entorno GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET son requeridas');
    process.exit(1);
}

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "http://localhost:5000/auth/google/callback",
    passReqToCallback: true
},
function(request, accessToken, refreshToken, profile, done) {
    try {
        console.log('Google Profile:', {
            id: profile.id,
            email: profile.email,
            displayName: profile.displayName
        });
        
        // Aquí podrías guardar el usuario en tu base de datos si lo necesitas
        // Por ejemplo:
        /*
        const user = {
            googleId: profile.id,
            email: profile.email,
            name: profile.displayName,
            photo: profile.photos[0].value
        };
        // Guardar en base de datos...
        */

        return done(null, profile);
    } catch (error) {
        console.error('Error en autenticación Google:', error);
        return done(error, null);
    }
}));

// Serializar el usuario
passport.serializeUser((user, done) => {
    try {
        done(null, user);
    } catch (error) {
        console.error('Error serializando usuario:', error);
        done(error, null);
    }
});

// Deserializar el usuario
passport.deserializeUser((user, done) => {
    try {
        done(null, user);
    } catch (error) {
        console.error('Error deserializando usuario:', error);
        done(error, null);
    }
});

module.exports = passport;