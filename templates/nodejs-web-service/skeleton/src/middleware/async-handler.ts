import type { NextFunction, Request, RequestHandler, Response } from 'express';

// Express 4 does not catch a rejected promise: an async route handler that
// throws leaves the request hanging, and the rejection is reported as
// unhandled. Wrap every async handler in this — the rejection becomes
// next(err) and ends in src/middleware/error-handler.ts as a problem document:
//
//   router.get('/orders/:id', asyncHandler(async (req, res) => { ... }));
//
// (typescript-eslint's no-misused-promises refuses an async function passed
// straight to Express, so a missing wrapper fails `npm run lint`.)
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
