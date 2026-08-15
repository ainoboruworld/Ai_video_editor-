# Deprecated: `apps/api`

There is no API service any more. The application is a single Next.js app at the
repository root and its backend lives in `src/app/api`.

This directory exists for one reason: a Vercel project (`ai-video-editor-api`)
was created when the repository was a monorepo, with its **Root Directory** set
to `apps/api`. Vercel resolves that path before it reads anything from the
repository, so once the directory was removed every deployment of that project
failed — with an error that no code change could fix.

What is here is a static notice page and a `vercel.json` that builds nothing, so
the legacy project deploys successfully and explains itself instead of failing.

**To remove this directory:** delete the `ai-video-editor-api` Vercel project (or
change its Root Directory to `/` with the Next.js preset), then delete
`apps/api`. Nothing in the application imports from it.

See [`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md) for the current deployment.
