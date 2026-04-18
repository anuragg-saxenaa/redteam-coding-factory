# ini-parse

**Description:** Parse INI configuration files.
**API:** `iniParse(iniData, defaults = {})`
**Example:**
```javascript
const config = iniParse('[section]\nkey=value', { defaultKey: 'fallback' });
// { section: { key: 'value' } }
```