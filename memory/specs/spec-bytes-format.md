# bytes-format

**Description:** Converts binary data to human-readable string representation.
**API:** `bytesFormat(data, length)`
**Example:**
```javascript
const data = Buffer.from('hello');
const formatted = bytesFormat(data, 5); // 'hello' (5 bytes)
```