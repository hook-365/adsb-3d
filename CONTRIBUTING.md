# Contributing to ADS-B 3D Viewer

Thank you for considering contributing to ADS-B 3D Viewer! We welcome contributions from the community.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Coding Guidelines](#coding-guidelines)
- [Submitting Changes](#submitting-changes)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)

## 🤝 Code of Conduct

This project follows a simple code of conduct:
- Be respectful and considerate
- Welcome newcomers and help them learn
- Focus on constructive feedback
- Keep discussions on-topic

## 💡 How Can I Contribute?

### Types of Contributions We Welcome

1. **Bug Fixes** - Fix issues in the tracker
2. **Feature Development** - Implement new features from the roadmap
3. **Documentation** - Improve README, code comments, or add tutorials
4. **Testing** - Test on different devices/browsers and report results
5. **Performance** - Optimize rendering or data processing
6. **Themes** - Create new visual themes
7. **Translations** - Help translate the UI (if multilingual support is added)

## 🛠️ Development Setup

### Prerequisites

- Docker & Docker Compose (for full stack testing)
- Node.js (optional, for local development)
- A working ADS-B receiver (ultrafeeder, tar1090, readsb, or dump1090)

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/hook-365/adsb-3d.git
   cd adsb-3d
   ```

2. **Set up environment**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

3. **Run with Docker Compose**
   ```bash
   # Live-only mode (no database)
   docker compose up adsb-3d

   # Full stack (with historical data)
   docker compose up
   ```

4. **Access the viewer**
   - Open http://localhost:8086

### File Structure

```
adsb-3d/
├── public/
│   ├── index.html          # Main HTML + CSS (themes)
│   ├── app.js              # Three.js rendering engine (~9000 lines)
│   ├── aircraft-shapes.js  # SVG aircraft definitions
│   └── aircraft-svg-system.js  # Shape rendering
├── track-service/
│   ├── main.py             # FastAPI backend + collector
│   └── requirements.txt
├── nginx/
│   └── nginx.conf          # Proxy configuration
└── docs/                   # Additional documentation
```

### Making Changes to the Frontend

The main application logic is in `public/app.js`. Key sections:

- **Lines 1-500**: Theme system and configuration
- **Lines 500-1500**: Data structures and utilities
- **Lines 1500-3500**: Historical mode and trail management
- **Lines 3500-5000**: Scene setup and rendering
- **Lines 5000-7000**: UI controls and interactions
- **Lines 7000-9000**: Aircraft display and updates

### Making Changes to the Backend

Track service code is in `track-service/main.py`:

- **Lines 1-150**: FastAPI setup and database migrations
- **Lines 150-400**: Aircraft collector (polls feeder every 5s)
- **Lines 400-800**: REST API endpoints

## 📝 Coding Guidelines

### JavaScript (Frontend)

- **Use JSDoc comments** for functions
  ```javascript
  /**
   * Description of what the function does
   * @param {string} param1 - Parameter description
   * @returns {boolean} Return value description
   */
  function myFunction(param1) {
      // ...
  }
  ```

- **Sanitize external data** before displaying
  ```javascript
  const safe = sanitizeHTML(externalData);
  element.textContent = safe;  // Prefer textContent over innerHTML
  ```

- **Dispose Three.js resources** properly
  ```javascript
  disposeGeometry(mesh.geometry);
  disposeMaterial(mesh.material);
  ```

- **Use SafeStorage** for localStorage operations
  ```javascript
  SafeStorage.setItem('key', 'value');
  const value = SafeStorage.getItem('key', 'default');
  ```

- **Add console logging** for debugging
  ```javascript
  console.log('[Feature] Descriptive message', data);
  ```

### Python (Backend)

- **Follow PEP 8** style guidelines
- **Use type hints** where possible
- **Add docstrings** to functions
- **Handle errors gracefully**
  ```python
  try:
      result = risky_operation()
  except Exception as e:
      logger.error(f"Operation failed: {e}")
      return {"error": str(e)}
  ```

### CSS/Themes

- **Use CSS variables** for colors
  ```css
  color: var(--text-primary);
  background: var(--panel-bg);
  ```

- **Test all 7 themes** when changing styles
- **Keep mobile responsive** (test at 768px width)

## 🔍 Testing Your Changes

### Before Submitting

1. **Test in multiple browsers**
   - Chrome/Edge (Chromium)
   - Firefox
   - Safari (if available)

2. **Test on mobile** (or use browser dev tools)
   - Rotate view (drag)
   - Zoom (pinch gesture)
   - Select aircraft (tap)

3. **Test edge cases**
   - 0 aircraft (empty sky)
   - 100+ aircraft (performance)
   - Network errors (offline mode)
   - Long-running session (24+ hours)

4. **Check console** for errors
   - Open browser DevTools (F12)
   - Look for JavaScript errors
   - Check for memory leaks (Performance tab)

### Performance Testing

Test your changes don't degrade performance:

```javascript
// Add timing logs
console.time('MyFeature');
myFeatureFunction();
console.timeEnd('MyFeature');
```

Monitor FPS in Chrome DevTools → Performance → Record

## 📤 Submitting Changes

### Creating a Pull Request

1. **Fork the repository** on GitHub

2. **Create a feature branch**
   ```bash
   git checkout -b feature/my-awesome-feature
   ```

3. **Make your changes**
   - Write clean, commented code
   - Test thoroughly

4. **Commit with clear messages**
   ```bash
   git commit -m "Add search bar to aircraft list

   - Implement fuzzy matching for callsign/ICAO/tail
   - Add clear button and keyboard shortcuts
   - Update UI with highlight on matches"
   ```

5. **Push to your fork**
   ```bash
   git push origin feature/my-awesome-feature
   ```

6. **Open a Pull Request**
   - Go to the original repository
   - Click "New Pull Request"
   - Select your branch
   - Fill in the PR template (if provided)

### PR Guidelines

- **Title**: Clear, concise description
- **Description**: Explain what changed and why
- **Screenshots**: Include before/after images for UI changes
- **Testing**: Describe how you tested
- **Breaking Changes**: Clearly note if any

### Example PR Description

```markdown
## Changes
- Added aircraft search bar with fuzzy matching
- Fixed memory leak in trail disposal
- Improved XSS protection in aircraft details

## Testing
- Tested with 50+ aircraft
- Verified search works for callsign, ICAO, tail number
- Confirmed memory usage stable over 2 hours
- Tested on Chrome, Firefox, Safari (iOS)

## Screenshots
[Include before/after images]
```

## 🐛 Reporting Bugs

### Before Filing a Bug

1. **Search existing issues** - your bug may already be reported
2. **Test on latest version** - bug may be fixed
3. **Gather information**:
   - Browser and version
   - Operating system
   - Console errors (F12 → Console)
   - Steps to reproduce

### Bug Report Template

```markdown
**Describe the bug**
A clear description of what the bug is.

**To Reproduce**
1. Go to '...'
2. Click on '...'
3. See error

**Expected behavior**
What you expected to happen.

**Screenshots**
If applicable, add screenshots.

**Environment:**
 - OS: [e.g. Windows 11]
 - Browser: [e.g. Chrome 120]
 - Version: [e.g. v1.1.0]
 - Deployment: [Docker / Manual]

**Console Errors**
```
Paste any JavaScript errors from console
```

**Additional context**
Any other relevant information.
```

## ✨ Suggesting Features

### Feature Request Template

```markdown
**Is your feature related to a problem?**
A clear description of the problem. Ex: I'm frustrated when [...]

**Describe the solution you'd like**
A clear description of what you want to happen.

**Describe alternatives**
Any alternative solutions you've considered.

**Use case**
How would this feature be used? Who benefits?

**Mockups/Examples**
If applicable, add mockups or examples from other apps.

**Additional context**
Any other context or screenshots.
```

### Feature Ideas Welcome

- Search and filtering improvements
- New visualization modes
- Statistics and analytics
- Integration with flight data APIs
- Mobile app features
- Performance optimizations

## 🏆 Recognition

Contributors will be acknowledged in:
- README.md Contributors section
- Release notes for significant contributions
- GitHub contributor graphs

## 📞 Questions?

- **Issues**: Open a GitHub issue with the "question" label
- **Discussions**: Use GitHub Discussions for broader topics
- **Community**: Join discussions in open issues

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to ADS-B 3D Viewer! 🛩️ ✨
