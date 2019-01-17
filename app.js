const express = require('express');
const passport = require('passport');
const OAuth2Strategy = require('./passport-oauth2');
const app = express();
const http = require('http');
const httpProxy = require('http-proxy');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const port = 3000;

const proxy = httpProxy.createProxyServer({});

app.use(cookieParser());
app.use(bodyParser.json());
app.use(session({ secret: 'anything' }));
app.use(passport.initialize());
app.use(passport.session()); // Used to persist login sessions

passport.use(
    new OAuth2Strategy(
        {
            authorizationURL: 'https://oauth.web.cern.ch/OAuth/Authorize',
            tokenURL: 'https://oauth.web.cern.ch/OAuth/Token',
            clientID: 'cms-runregistry',
            clientSecret: 'h00FZSTyBjlalYKp7GqdBZQP2heMeaqLnpSNiTNXvcc1',
            callbackURL: 'https://cmsrunregistry.web.cern.ch/callback'
        },
        function(accessToken, refreshToken, profile, done) {
            profile.accessToken = accessToken;
            console.log('profile', profile);
            done(null, profile);
        }
    )
);

// Used to stuff a piece of information into a cookie
passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((user, done) => {
    done(null, user);
});

// Middleware to check if the user is authenticated
function isUserAuthenticated(req, res, next) {
    console.log('is user auth user', req.user);
    if (req.user) {
        next();
    } else {
        res.send('You must login!');
    }
}

app.get(
    '/callback',
    passport.authenticate('oauth2', {
        failureRedirect: '/error'
    }),
    function(req, res) {
        console.log(req.user.displayName);
        res.redirect('/secret');
    }
);

// Logout route
app.get('/logout', (req, res) => {
    req.logout();
    res.redirect('/');
});
app.get('/error', (req, res) => {
    res.send('Error authenticating user');
});

// This proxy redirects API requests and client side requests

// API requests (GET, POST, PUT, ...):
app.all('/api/*', (req, res) => {
    req.url = req.url.split('/api')[1];
    console.log(req.url);
    proxy.web(req, res, {
        target: 'http://cms-rr-prod.cern.ch:7003'
    });
});
app.post;

// Client requests
app.all('*', passport.use('oauth2'), (req, res) => {
    proxy.web(req, res, {
        target: 'http://cms-rr-prod.cern.ch:7001'
    });
});

app.listen(port, () => console.log('SSO Hello world started'));
