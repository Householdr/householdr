import type { TestAccount } from '@householdr/auth/testing';

/** The account the test server's database starts with: invented, as all test data (TEST-8). */
export const account: TestAccount = {
  email: 'robin@example.org',
  password: 'correct horse battery staple',
};
