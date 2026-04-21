# CLI

OAuth Device Flow CLI for getting and optionally storing the GitHub token used by the service.

## Install

```bash
npm install -g copilot-portal
```

Or run it without installing:

```bash
npx copilot-portal auth
```

## Usage

Get a token interactively:

```bash
npx copilot-portal auth
```

Get and save the token locally:

```bash
npx copilot-portal auth --save
```

Print the saved token:

```bash
npx copilot-portal token
```

Force re-authentication (ignore cached token):

```bash
npx copilot-portal auth --refresh
```

The saved token is stored at `~/.copilot-portal/token`.
