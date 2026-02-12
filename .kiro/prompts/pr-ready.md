# PR Ready

Ensure code is ready for pull request by running lint and validation checks.

## Steps

1. **Install dependencies** (if needed):
   ```bash
   npm ci
   ```

2. **Run linter**:
   ```bash
   npm run lint
   ```

3. **Fix lint issues** (if any):
   ```bash
   npm run lint:fix
   ```

4. **Run tests**:
   ```bash
   npm test
   ```

5. **Security audit**:
   ```bash
   npm audit --audit-level=high
   ```

## GitHub Actions Validation

These checks mirror the CI pipeline in `.github/workflows/deploy.yml`:
- `npm ci` - Install dependencies
- `npm audit --audit-level=high` - Security audit
- `npm run lint` - ESLint validation
- `npm test` - Jest tests

## Notes
- ESLint config: `.eslintrc.js` or `package.json`
- Test pattern: `**/lib/**/__tests__/**/*.test.js`
- Fix any issues before creating PR
