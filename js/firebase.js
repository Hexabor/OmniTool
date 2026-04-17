// === Firebase Init ===
const firebaseConfig = {
    apiKey: "AIzaSyBprgV9wtIOT7guPO3oseugHoJkM2Dge5Q",
    authDomain: "omnitool-c1ed2.firebaseapp.com",
    projectId: "omnitool-c1ed2",
    storageBucket: "omnitool-c1ed2.firebasestorage.app",
    messagingSenderId: "434192285247",
    appId: "1:434192285247:web:b98df10d29783e72cfc28a"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// === Store management ===
const STORE_KEY = 'omni_store';

function getStoreCode() {
    return localStorage.getItem(STORE_KEY);
}

function setStoreCode(code) {
    localStorage.setItem(STORE_KEY, code);
}

function clearStoreCode() {
    localStorage.removeItem(STORE_KEY);
}

// === Firestore helpers for module data ===
function storeDocRef(module) {
    const code = getStoreCode();
    if (!code) return null;
    return db.collection('stores').doc(code).collection('modules').doc(module);
}

async function saveModuleData(module, data) {
    const ref = storeDocRef(module);
    if (!ref) return;
    data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await ref.set(data, { merge: true });
}

async function loadModuleData(module, opts) {
    const ref = storeDocRef(module);
    if (!ref) return null;
    const snap = await ref.get(opts || {});
    return snap.exists ? snap.data() : null;
}

async function deleteModuleData(module) {
    const ref = storeDocRef(module);
    if (!ref) return;
    await ref.delete();
}

// === Archive helpers ===
function archiveCollectionRef(module) {
    const ref = storeDocRef(module);
    if (!ref) return null;
    return ref.collection('archives');
}

async function saveArchive(module, archiveId, data) {
    const col = archiveCollectionRef(module);
    if (!col) return;
    data.archivedAt = firebase.firestore.FieldValue.serverTimestamp();
    await col.doc(archiveId).set(data);
}

async function loadArchive(module, archiveId) {
    const col = archiveCollectionRef(module);
    if (!col) return null;
    const snap = await col.doc(archiveId).get();
    return snap.exists ? snap.data() : null;
}

async function listArchives(module) {
    const col = archiveCollectionRef(module);
    if (!col) return [];
    const snap = await col.orderBy('archivedAt', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function deleteArchive(module, archiveId) {
    const col = archiveCollectionRef(module);
    if (!col) return;
    await col.doc(archiveId).delete();
}

async function deleteAllStoreData() {
    const code = getStoreCode();
    if (!code) return;
    // Delete all module docs under this store
    const modules = await db.collection('stores').doc(code).collection('modules').get();
    const batch = db.batch();
    modules.forEach(doc => batch.delete(doc.ref));
    // Delete the store doc itself
    batch.delete(db.collection('stores').doc(code));
    await batch.commit();
}
