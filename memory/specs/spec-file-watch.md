# file-watch

**Description:** Watch a file for changes and trigger a callback.
**API:** `watchFile(path, callback)`
**Example:**
```javascript
watchFile('config.json', (event) => {
  console.log('File changed!', event);
});
```