# Agent Instructions

Guidelines for AI agents (Claude, Cursor, Copilot, etc.) working on this codebase.

## Helping New Developers Onboard

When a new developer asks for help getting started, guide them through these steps:

### Prerequisites Check
First, verify they have:
- Node.js v20+ (`node --version`)
- pnpm v8+ (`pnpm --version`)

If missing, point them to:
- Node: https://nodejs.org or use nvm
- pnpm: `npm install -g pnpm`

### Access Requirements
They need:
1. **Environment variables** - See `docs/secrets.md` for required variables
2. **Convex account** - Free at https://convex.dev (they'll create during setup)

### Step-by-Step Setup

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your values (see docs/secrets.md)
   ```

3. **Create personal Convex deployment:**
   ```bash
   npx convex dev
   ```
   - This opens browser for Convex login
   - Select "Create a new project"
   - Name it "{{APP_NAME}}-[their-name]-dev"
   - Keep this terminal running

4. **Seed test data (new terminal):**
   ```bash
   npx convex run functions/seed:seedDemoData
   ```

5. **Start development:**
   ```bash
   pnpm dev
   ```

6. **Test the app:**
   - Open iOS Simulator or Expo Go (mobile apps)
   - Or open browser (web apps)
   - Login with the seeded test phone number and OTP bypass code

### Troubleshooting

- **Convex auth fails** - Run `npx convex logout` then `npx convex dev` again
- **Empty app / no data** - They forgot to run the seed script
- **Styles not loading** - Make sure NativeWind/Tailwind is configured; check `tailwind.config.js`

## Development Workflow

### Environment Setup
- Environment variables are documented in `docs/secrets.md`
- Depending on what the user is asking, use the relevant keys from the relevant environment (dev, staging, prod)
- Typically you will only make dev or staging related changes, double check if any action you take will affect production

### Agent Backend Selection (Maintainer CI Agents Only)

This section applies **only** to Cursor Cloud Agents and similar CI agents run by project maintainers. Open-source contributors should ignore this section — you create your own personal Convex deployment via `npx convex dev` (see "Helping New Developers Onboard" above).

- Before any backend-affecting command, ask: **"Which backend should I use?"** and list the backends defined in `config/allowed-backends.json`.
- Do not proceed until the user answers.
- Use `pnpm dev:backend --backend=<choice>` only.
- Each concurrent agent **must** use a different backend to avoid data conflicts.

### Test-Driven Development

- **Write tests first** - Create failing tests before implementing features
- Tests serve as specification and prevent regressions
- Run tests after implementation to verify correctness

### Visual Verification

- **Use Playwright** to confirm UI changes look correct
- Don't assume - verify components render as expected
- Take screenshots for complex UI changes when helpful
- **Act autonomously** - don't ask permission for each Playwright action

### Testing

When testing the app (Playwright, iOS Simulator, etc.), use the seeded test credentials from the seed script. The test phone number and OTP bypass code are configured in the seed data.

> **Note:** If test data doesn't exist, run the seed script first:
> ```bash
> npx convex run functions/seed:seedDemoData
> ```

**Development Commands:**

| Command             | What it does                                      |
| ------------------- | ------------------------------------------------- |
| `pnpm dev`          | Run Convex dev + app together                     |
| `pnpm dev --mobile` | Run only Expo (if Convex is already running)      |
| `pnpm dev --web`    | Run only web app (if Convex is already running)   |
| `pnpm dev --convex` | Run only Convex dev                               |
| `pnpm test`         | Run tests                                         |
| `pnpm typecheck`    | TypeScript type checking                          |
| `pnpm lint`         | Run linter                                        |

**App URLs:**

- Web/Metro: http://localhost:8081
- Convex Dashboard: Run `pnpm convex:dashboard`
- Convex Logs: Run `pnpm convex:logs`

### Git Discipline

- **Commit frequently** - Make atomic commits after each logical change
- Write descriptive commit messages explaining "why" not just "what"
- Don't batch unrelated changes into single commits

### Branch Protection

- **Never push directly to `main`** - Branch protection will reject it
- **Always create a PR** - Even for small changes
- PRs require passing CI and **all conversations resolved** before merge
- The workflow is: `feature branch` -> PR -> `main`

### Branch & PR Hygiene

**1. One feature per branch, one purpose per PR**
- Branch names should describe a single, scoped change (e.g., `fix/email-parsing`, `feat/inbox-filters`)
- If work expands beyond the original scope, **create a new branch**
- Never add unrelated changes to an existing feature branch

**2. Keep PRs small and focused**
- PRs should stay under **~500 lines changed** (soft limit)
- If a PR exceeds **1000 lines**, it MUST be split into smaller PRs
- Each PR should be reviewable in one sitting

**3. Merge early, merge often**
- Never let a branch drift more than **2 days** behind main
- If main has moved ahead, rebase or merge main into your branch
- Prefer multiple small PRs over one large PR

**4. Before starting work, check branch state**
```bash
# Check how far ahead current branch is
git log main..HEAD --oneline

# If >10 commits ahead with pending PR, consider:
# 1. Merge the existing PR first
# 2. Create a new branch for new work
```

**5. Scope creep = new branch**
If you're asked to do X and realize Y and Z also need fixing:
- Finish X on current branch, create PR
- Create new branch for Y
- Create new branch for Z
- Never bundle unrelated changes

## Code Philosophy

### Simplicity First

- **Prefer readable code over clever code** - even if it means rewriting
- Three similar lines of code is better than a premature abstraction
- If a solution requires extensive explanation, it's too complex

### Remove, Don't Deprecate

- **Delete old patterns** rather than keeping both old and new
- Don't add backwards-compatibility shims when you can just change the code
- Remove unused code, don't comment it out

### Avoid Over-Engineering

- Only make changes that are directly requested or clearly necessary
- Don't add features, refactoring, or "improvements" beyond what was asked
- Don't design for hypothetical future requirements

### Native Dependency Safety

- **Never bump `runtimeVersion`** — it must stay in sync with production native builds
- New native dependencies must be **gated** behind `NativeModules` runtime checks
- Add detection functions for native module availability
- Create safe wrapper components that fall back gracefully
- Classify all native deps in `apps/mobile/native-deps.json` as `core` or `gated`
- CI enforces this via `@supa/native-safety` — static imports of gated deps fail

### Prefer Framework Features Over Custom Solutions

- **Always prefer built-in framework features** over custom implementations
- Use Expo Router tabs instead of custom tab bar components
- Use React Navigation patterns instead of custom navigation wrappers
- If a framework provides a solution, use it - don't reinvent the wheel
- Custom components should only exist when framework features genuinely can't meet requirements

### Design Decisions Require Consultation

- **ASK before making architectural/design decisions** - don't assume
- When multiple valid approaches exist, present the options with trade-offs
- Always prefer the cleaner, more elegant solution even if it requires more refactoring
- If unsure whether something is a design decision, err on the side of asking
- Examples of decisions that require consultation:
  - Custom components vs framework features
  - State management approaches
  - Navigation patterns
  - API design choices
  - File/folder structure changes

## Documentation Standards

### Code Comments

- Add JSDoc/docstrings for non-obvious functions
- Document "why" not "what" - code shows what, comments explain why
- Link frontend types to backend schemas where applicable

### Architecture Docs

- See `/docs/architecture/` for Architecture Decision Records (ADRs)
- Each feature folder may have an `ARCHITECTURE.md` explaining its structure

### Publishing / Shipping

- To publish this app (Convex + web + iOS/TestFlight + OTA), follow the Supa
  framework's **`docs/PUBLISHING.md`** guide:
  https://github.com/Supa-Media/supa-framework/blob/main/docs/PUBLISHING.md
- The secrets model it relies on is documented in `docs/SECRETS.md`
  (1Password → GitHub → server env).

### Keep Docs Updated

- **Update documentation when implementing features** - don't leave stale docs
- If you change an API, update the corresponding contracts and types
- If you refactor a feature, update its ARCHITECTURE.md
- If docs are wrong, fix them - don't just work around them

## File and Project Hygiene

### Keep the Codebase Clean

- **Put docs in proper folders** - never leave analysis/planning docs in root
  - `/docs/architecture/` - ADRs and architectural decisions
  - `/docs/archive/` - historical analysis, completed migrations
  - Feature folders - feature-specific docs (ARCHITECTURE.md)
- Only `README.md` and `CLAUDE.md` belong in root
- Delete temporary or one-off analysis files after they've served their purpose

### Leave Code Better Than You Found It

- If you encounter unnecessarily complex code, simplify it or document why it's complex
- Add `// TODO: Investigate - [reason]` comments for suspicious patterns
- Remove dead code, unused imports, and commented-out blocks
- Fix small issues you notice (typos, formatting) while working on related code

### Document Complexity

- If you can't simplify something, document why it's complex
- Leave breadcrumbs for future investigation:
  ```typescript
  // NOTE: This workaround is needed because [reason]
  // See: [link to issue or discussion]
  ```
- Flag technical debt explicitly rather than hiding it

## Working Style

### Front-Load Questions

- **Ask all questions before implementing** - don't start then realize you need more info
- Tell the user how many questions you have (e.g., "I have 3 questions before starting")
- Ask questions one at a time for easier answering
- Once all questions are answered, execute without interruption

### Orchestrator Pattern

- **Act as an orchestrator**, not a doer for large tasks
- Your role: scope the work, break it into pieces, delegate to subagents
- Prepare clear, self-contained prompts for each subagent
- Subagents should be able to complete their task without asking questions

Example workflow:

```
1. User requests feature
2. YOU ask all clarifying questions upfront
3. User answers
4. YOU create implementation plan
5. YOU spawn subagents for each piece:
   - Task("Write tests for X", subagent_type="general-purpose")
   - Task("Implement backend for X", subagent_type="general-purpose")
   - Task("Implement frontend for X", subagent_type="general-purpose")
6. YOU review and commit
```

### Protect Context

- **Context is precious** - don't pollute it with exploration
- Use subagents for: searching code, reading files, investigating issues
- Keep main conversation focused on decisions and coordination
- If you need to read 10 files to understand something, spawn a subagent
- Return concise summaries from subagents, not raw data

## Tech Stack Quick Reference

### Backend

- **Framework**: Convex (serverless functions + database)
- **Functions**: `/apps/convex/functions/` - queries, mutations, actions
- **Background jobs**: Convex crons (`apps/convex/crons.ts`) and `ctx.scheduler` for scheduled/event-triggered jobs
- **Real-time**: Convex reactive queries and messaging
- **Schemas**: Convex validators for type safety
- **Auth**: `@convex-dev/auth` (phone OTP + email OTP)

### Frontend

- **Mobile**: React Native + Expo
- **Web**: React Native Web + Expo (web target)
- **Routing**: Expo Router (file-based)
- **Styling**: NativeWind (Tailwind CSS)
- **State**: Convex hooks (`useQuery`, `useMutation`, `useAction`)
- **Error tracking**: Sentry
- **Analytics / Feature flags**: PostHog

### Supa Framework Packages

- **`@supa/core`** - Core configuration and utilities
- **`@supa/convex`** - Convex backend helpers and patterns
- **`@supa/native-safety`** - Native dependency gating for OTA safety
- **`@supa/notifications`** - Push notification infrastructure
- **`@supa/testing`** - Test utilities and fixtures
- **`@supa/dev`** - Development server orchestration
- **`@supa/linter`** - ESLint configuration
- **`@supa/metro`** - Metro bundler configuration
- **`@supa/claude`** - Claude Code configuration (this package)

### Infrastructure

- **Monorepo**: pnpm workspaces + Turborepo
- **CI/CD**: GitHub Actions
- **Backend tests**: Vitest
- **E2E tests**: Playwright

### Integrations (configure in supa.config.ts)

- **SMS**: Twilio (OTP verification, notifications)
- **Transactional email**: Resend (confirmations, notifications)
- **Push notifications**: Expo Push API
- **Maps**: Mapbox
- **Storage**: Cloudflare R2 (file storage, image transformations)
- **Payments**: Stripe (if enabled)

## Key Patterns

### API Data Flow

```
Convex Function (TypeScript)        ->  Real-time subscription  ->  Frontend Component
api.functions.groups.list           ->  useQuery()              ->  GroupListScreen
(apps/convex/functions/groups.ts)
```

### React Native Web Pitfalls

These are **critical** gotchas when writing UI for React Native Web (Expo).

#### Pressable function-based `style` prop does NOT work on web

`Pressable` accepts a function for its `style` prop: `style={({ pressed }) => ({ ... })}`. On React Native Web, **none of the styles in this function are applied**. Use an inner `<View>` with static `style` or `className` for layout. Use `className` with Tailwind active/hover variants for press states (e.g. `active:opacity-80`).

#### ScrollView content doesn't stretch to fill width

Add `contentContainerStyle={{ flexGrow: 1 }}` to the `ScrollView` and `style={{ width: "100%" }}` on the inner container.
