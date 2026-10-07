// Business rules as pure functions over plain data: no I/O, no clock, no randomness (ADR-0008 §3, CODE-5).
export { expand } from './schedules/expand';
export { frequencyRule, type Frequency } from './schedules/frequency';
export type { Rule, Schedule, Season } from './schedules/schedule';
