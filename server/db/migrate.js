'use strict';
// Apply the schema (idempotent — all CREATEs are IF NOT EXISTS).
const { migrate } = require('./connection');
migrate();
console.log('Database schema is up to date.');
