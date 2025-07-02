class Cache {
    constructor() {
        this.cache = new Map();
    }

    set(key, value, ttlSeconds) {
        const expirationTime = Date.now() + ttlSeconds * 1000;
        this.cache.set(key, { value, expirationTime });
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return undefined;

        if (Date.now() > item.expirationTime) {
            this.cache.delete(key);
            return undefined;
        }

        return item.value;
    }

    delete(key) {
        this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }
}

module.exports = Cache;
