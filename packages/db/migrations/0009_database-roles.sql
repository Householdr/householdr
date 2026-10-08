-- The owner runs the migrations and owns the tables; the app and the worker connect as another role,
-- which row-level security always binds (ADR-0008 §9, clarification). The owner isn't bound, so its
-- lookup functions can find households before one is set.
ALTER TABLE "households" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "members" NO FORCE ROW LEVEL SECURITY;
