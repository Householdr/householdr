// Schema, migrations and queries (ADR-0008 §3, §9).
export { connect, database, inHousehold, type Database, type Transaction } from './connection';
export { migrate } from './migrate';
export * from './auth-schema';
export * from './schema';
