const { Firestore } = require('@google-cloud/firestore');
const fs = require('fs');
const path = require('path');

let db;
const isProduction = process.env.NODE_ENV === 'production' || process.env.FIRESTORE_PROJECT_ID;

if (isProduction) {
    console.log('Connecting to GCP Firestore...');
    // In GCP Cloud Run, it automatically authenticates if the service account has Firestore access.
    // If running locally with GCP env variables, make sure FIRESTORE_PROJECT_ID is set.
    const config = {};
    if (process.env.FIRESTORE_PROJECT_ID) {
        config.projectId = process.env.FIRESTORE_PROJECT_ID;
    }
    if (process.env.FIRESTORE_DATABASE_ID) {
        config.databaseId = process.env.FIRESTORE_DATABASE_ID;
    }
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        config.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
    db = new Firestore(config);
} else {
    console.log('Using local JSON file database for development...');
    const localDbPath = path.join(__dirname, '..', 'db.json');
    
    // Initialize JSON db file if it doesn't exist
    if (!fs.existsSync(localDbPath)) {
        fs.writeFileSync(localDbPath, JSON.stringify({ posts: [], comments: [] }, null, 2), 'utf8');
    }

    class MockQuery {
        constructor(collectionName, items = null) {
            this.collectionName = collectionName;
            this.items = items;
        }

        _getItems() {
            if (this.items !== null) return this.items;
            if (!fs.existsSync(localDbPath)) return [];
            try {
                const data = JSON.parse(fs.readFileSync(localDbPath, 'utf8'));
                return data[this.collectionName] || [];
            } catch (e) {
                return [];
            }
        }

        where(field, operator, value) {
            const filtered = this._getItems().filter(item => {
                const itemVal = item[field];
                switch (operator) {
                    case '==': return itemVal === value;
                    case '!=': return itemVal !== value;
                    case '>': return itemVal > value;
                    case '<': return itemVal < value;
                    case '>=': return itemVal >= value;
                    case '<=': return itemVal <= value;
                    default: return true;
                }
            });
            return new MockQuery(this.collectionName, filtered);
        }

        orderBy(field, direction = 'asc') {
            const sorted = [...this._getItems()].sort((a, b) => {
                const valA = a[field];
                const valB = b[field];
                if (direction === 'desc') {
                    return valA > valB ? -1 : valA < valB ? 1 : 0;
                }
                return valA > valB ? 1 : valA < valB ? -1 : 0;
            });
            return new MockQuery(this.collectionName, sorted);
        }

        limit(n) {
            const limited = this._getItems().slice(0, n);
            return new MockQuery(this.collectionName, limited);
        }

        async get() {
            return {
                docs: this._getItems().map(item => ({
                    id: item.id,
                    data: () => item
                }))
            };
        }
    }
    
    // Simple helper to mimic Firestore collection/doc API
    db = {
        collection: (collectionName) => {
            const getData = () => JSON.parse(fs.readFileSync(localDbPath, 'utf8'));
            const saveData = (data) => fs.writeFileSync(localDbPath, JSON.stringify(data, null, 2), 'utf8');
            
            const query = new MockQuery(collectionName);
            
            query.doc = (id) => {
                return {
                    get: async () => {
                        const data = getData();
                        const item = (data[collectionName] || []).find(item => item.id === id);
                        return {
                            exists: !!item,
                            id: id,
                            data: () => item
                        };
                    },
                    set: async (docData) => {
                        const data = getData();
                        if (!data[collectionName]) data[collectionName] = [];
                        const index = data[collectionName].findIndex(item => item.id === id);
                        const finalData = { id, ...docData };
                        if (index > -1) {
                            data[collectionName][index] = finalData;
                        } else {
                            data[collectionName].push(finalData);
                        }
                        saveData(data);
                        return true;
                    },
                    delete: async () => {
                        const data = getData();
                        if (!data[collectionName]) return true;
                        data[collectionName] = data[collectionName].filter(item => item.id !== id);
                        saveData(data);
                        return true;
                    }
                };
            };
            
            query.add = async (docData) => {
                const data = getData();
                if (!data[collectionName]) data[collectionName] = [];
                const id = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
                const newDoc = { id, ...docData };
                data[collectionName].push(newDoc);
                saveData(data);
                return { id };
            };
            
            return query;
        }
    };
}

module.exports = db;
