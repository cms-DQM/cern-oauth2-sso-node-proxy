/*

CERN SSO Proxy

*/
require('dotenv').config()
const express = require('express');
const app = express();
const http = require('http');
const httpProxy = require('http-proxy');
const session = require('express-session');
const MemoryStore = require('memorystore')(session)
const Keycloak = require('keycloak-connect');

const keycloak_config = {
  'realm': 'cern',
  'auth-server-url': 'https://auth.cern.ch/auth',
  'ssl-required': "all",
  'resource': process.env.CLIENT_ID,
  'credentials': { 'secret': process.env.CLIENT_SECRET },
  'issuer': 'https://auth.cern.ch/auth/realms/cern',
  'authorization_endpoint':
    'https://auth.cern.ch/auth/realms/cern/protocol/openid-connect/auth',
  'token_endpoint':
    'https://auth.cern.ch/auth/realms/cern/protocol/openid-connect/token',
  'token_introspection_endpoint':
    'https://auth.cern.ch/auth/realms/cern/protocol/openid-connect/token/introspect',
  'userinfo_endpoint':
    'https://auth.cern.ch/auth/realms/cern/protocol/openid-connect/userinfo',
  'end_session_endpoint':
    'https://auth.cern.ch/auth/realms/cern/protocol/openid-connect/logout',
  'jwks_uri':
    'https://auth.cern.ch/auth/realms/cern/protocol/openid-connect/certs',
};
const port = process.env.SERVER_PORT || 8080;

const long_timeout = 2147483640;
const proxy = httpProxy.createProxyServer({
  timeout: long_timeout,
  proxyTimeout: long_timeout,
});

const server = http.createServer(app);
server.setTimeout(process.env.SERVER_TIMEOUT || 500000);
server.timeout = 100 * 60 * 1000;
server.on('upgrade', function (req, res, head) {
  proxy.ws(req, res, head, { target: process.env.API_URL });
});

// Not setting checkPeriod at all in MemoryStore, as it may lead to storing
// expired tokens. 
// CERN SSO limits: https://auth.docs.cern.ch/user-documentation/time-limits/
const memoryStore = new MemoryStore();
const keycloak = new Keycloak({ store: memoryStore }, keycloak_config);


app.use(session({
  secret: 'cern',
  resave: true,
  saveUninitialized: true,
  store: memoryStore,
}));

// See here for details: https://lists.jboss.org/pipermail/keycloak-dev/2019-August/012406.html
app.set('trust proxy', true);

// This automatically adds a "/logout" endpoint which
// will take care of the logout automatically.
app.use(keycloak.middleware({ logout: '/logout' }));
// This proxy can also work with an API if provided the API_URL env. variable:
// Authentication will work normally for a browser that accesses the API, since
// it already has the session cookie. For API use, it will need to provide with
// all the cookies after OAUTH API requests (GET, POST, PUT, ...):
if (process.env.API_URL) {
  app.all('/api/*', keycloak.protect(), (req, res) => {
    // Remove the api from url:
    const new_path = req.url.split('/api')[1];
    req.path = new_path;
    req.url = new_path;
    req.originalUrl = new_path;
    req.setTimeout(500000);
    res.setTimeout(500000);
    proxy.on('proxyReq', (proxyReq, req, res, options) => {
      req.setTimeout(500000);
      res.setTimeout(500000);
      const {
        kauth: {
          grant: {
            access_token: { content: { cern_roles, name, cern_person_id, email, sub, sid } }
          }
        }
      } = req;
      // When using a token to access the app programmatically, there's no name
      // so we're checking at the subscriber name too. 
      if (name || sub) {
        let formatted_cern_roles = formatRoles(cern_roles);
        proxyReq.setHeader('displayname', name || sub);
        // TODO: maybe change the header name to "roles" at some point.
        // The client app receiving the requests must also be changed.
        proxyReq.setHeader('egroups', formatted_cern_roles);
        proxyReq.setHeader('email', email || 'api@client');
        proxyReq.setHeader('id', cern_person_id || sid);
        // uncomment the following for some logs printout while
        // developing
        if (process.env.ENV == 'development') {
          let timestamp = '[' + (new Date()).toLocaleString() + '] ';
          console.log(`Timestamp: ${timestamp}`);
          console.log(`Display name: ${name || sub}`);
          console.log(`email: ${email}`);
          console.log(`egroups: ${formatted_cern_roles}`);
          console.log(`User ID: ${cern_person_id || sid}`);
        };
      }
    });
    proxy.web(req, res, {
      target: process.env.API_URL,
      timeout: long_timeout,
      proxyTimeout: long_timeout,
    });
  });
}

// Client requests
app.all('*', keycloak.protect(), (req, res) => {
  proxy.on('proxyReq', (proxyReq, req, res, options) => {
    req.setTimeout(500000);
    res.setTimeout(500000);

    const {
      kauth: {
        grant:
        { access_token: { content: { cern_roles, name, cern_person_id, email, sub, sid } } }
      }
    } = req;
    if (name || sub) {
      let formatted_cern_roles = formatRoles(cern_roles)

      proxyReq.setHeader('displayname', name || sub);
      proxyReq.setHeader('egroups', formatted_cern_roles);
      proxyReq.setHeader('email', email || 'api@client');
      proxyReq.setHeader('id', cern_person_id || sid);

      // uncomment the following for some logs printout while
      // developing
      if (process.env.ENV == 'development') {
        let timestamp = '[' + (new Date()).toLocaleString() + '] ';
        console.log(`Timestamp: ${timestamp}`);
        console.log(`Display name: ${name || sub}`);
        console.log(`email: ${email}`);
        console.log(`egroups: ${formatted_cern_roles}`);
        console.log(`User ID: ${cern_person_id || sid}`);
      };
    }
  });
  proxy.web(req, res, {
    target: process.env.CLIENT_URL,
  });
});

// If something goes wrong on either API or client:
proxy.on('error', function (err, req, res) {
  var timestamp = '[' + (new Date()).toLocaleString() + '] ';
  console.log(timestamp);
  console.log(err);
  try {
    res.writeHead(500, {
      'Content-Type': 'text/plain',
    });

    res.end(`${err.message} ----------- ${JSON.stringify(err)}`);
  } catch (e) {
  }
});

server.listen(port, () => {
  console.log(`OAUTH Proxy started on port ${port}`)
});
server.timeout = long_timeout;

function formatRoles(roles_array) {
  let formatted_roles = '';
  roles_array.forEach(role => {
    formatted_roles += role + ';';
  });
  return formatted_roles;
}