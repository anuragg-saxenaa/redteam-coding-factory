# sleep-until

**Description:** Asynchronous wait until a condition is true or timeout occurs.
**API:** `await sleep(untilFn, {timeout: ms})`
**Example:**
```javascript
const result = await sleep(() => dataReady(), {timeout: 5000});
```