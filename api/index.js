const { createApp } = require("../src/server");
const { createDatabasePool } = require("../src/mysql-database");

const pool = createDatabasePool({ connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 2) });
const app = createApp({ pool, secureCookies: true });
const handleRequest = app.listeners("request")[0];

module.exports = (request, response) => handleRequest(request, response);
