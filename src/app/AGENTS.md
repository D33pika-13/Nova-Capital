# Next.js application layer

- Use function-based pages/layouts and framework route handlers. Keep business rules in backend service classes.
- Never import privileged backend code into client components. Derive identity from verified sessions in server entrypoints.
- Authenticate and authorize every protected action; a layout redirect or hidden button is insufficient.
- Validate requests, protect cookie-authenticated mutations against CSRF, and avoid caching personalized responses across users.
- Verify navigation, loading/empty/error states, responsive behavior, accessibility and protected route/API behavior.
