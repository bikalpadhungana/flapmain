# Antygravity

## Overview
Antygravity is under active development. This README covers how the project is set up, how to run it locally, and how development is tracked.

> **Project design:** See [`aboutproject.md`](./aboutproject.md) for the full system architecture and phased development plan (this is FlapMain — Flap's central IoT platform).
>
> **Development log:** Every update made to this platform — features, fixes, schema changes, infra changes — must also be recorded in [`developmentplan.md`](./developmentplan.md). That file is the single source of truth for what has shipped, what's in progress, and what's planned next. If it's not in `developmentplan.md`, it's not considered done.

## Tech Stack
- **Backend:** Node.js / Express
- **Frontend:** React
- **Database:** MongoDB
- _(Update this section as the stack is finalized)_

## Getting Started

### Prerequisites
- Node.js (LTS)
- MongoDB instance (local or Atlas)
- npm or yarn

### Installation
```bash
git clone <repo-url>
cd antygravity
npm install
```

### Environment Variables
Create a `.env` file in the root:
```
PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_secret_key
```

### Running Locally
```bash
npm run dev
```

## Project Structure
```
antygravity/
├── backend/          # API server
├── frontend/         # React client
├── docs/             # Documentation
├── developmentplan.md
└── README.md
```

## Development Workflow
1. Create a feature branch from `main`.
2. Build and test the change locally.
3. **Update `developmentplan.md`** with what changed, under the current phase/date.
4. Open a pull request for review.
5. Merge once approved.

## Contributing
- Keep commits focused and descriptive.
- Document any new environment variables, endpoints, or schema changes in `developmentplan.md`.
- Flag breaking changes clearly in the PR description.

## License
_(To be determined)_
# flapmain
