import { setupServer } from 'msw/node';

/** Shared MSW server for tests that exercise the real (non-mock-mode) Kickflip/BigCommerce HTTP clients. */
export const mswServer = setupServer();
