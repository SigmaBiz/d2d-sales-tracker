# GitHub Repository Setup Instructions

## Option 1: Using GitHub CLI (Recommended)

If you have GitHub CLI installed, run:
```bash
gh repo create d2d-sales-tracker --public --source=. --push
```

## Option 2: Manual Setup

1. Go to https://github.com/new
2. Repository name: `d2d-sales-tracker`
3. Description: "Mobile app for door-to-door sales tracking with GPS, analytics, and offline functionality"
4. Choose Public or Private
5. DO NOT initialize with README (we already have one)
6. Click "Create repository"

Then run these commands:
```bash
git remote add origin https://github.com/YOUR_USERNAME/d2d-sales-tracker.git
git branch -M main
git push -u origin main
```

## Option 3: Using GitHub.com

1. Visit https://github.com
2. Click the "+" icon → "New repository"
3. Name: d2d-sales-tracker
4. Add description
5. Choose visibility
6. Create repository
7. Follow the "push an existing repository" instructions shown

## After Setup

Your repository will be available at:
`https://github.com/YOUR_USERNAME/d2d-sales-tracker`

## Recommended Repository Settings

1. Go to Settings → General
2. Add topics: `react-native`, `expo`, `sales-tracking`, `mobile-app`, `typescript`
3. Add a description
4. Consider adding:
   - Issues templates
   - Pull request template
   - Contributing guidelines
   - License (if applicable)