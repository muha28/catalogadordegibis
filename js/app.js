import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getAuth, 
    signInWithPopup, 
    signInWithRedirect, 
    getRedirectResult, 
    GoogleAuthProvider, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyCp1T_3QhVTTE7zd8v-X50dTpP-jHzOUek",
    authDomain: "gibis-da-bibi.firebaseapp.com",
    projectId: "gibis-da-bibi",
    storageBucket: "gibis-da-bibi.firebasestorage.app",
    messagingSenderId: "1069619452025",
    appId: "1:1069619452025:web:82d0743ae68029df595ca8"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

let fundosPersonagens = { "default": "" };
let database = {};
let currentSheet = "";
let editingIndex = null;
let currentUser = null;

// Trata o retorno do login por redirecionamento no mobile
getRedirectResult(auth).catch((error) => {
    console.error("Erro no retorno do login via redirect:", error);
});

onAuthStateChanged(auth, async (user) => {
    const loginScreen = document.getElementById('loginScreen');
    const mainApp = document.getElementById('mainApp');
    const statusEl = document.getElementById('userStatus');

    if (user) {
        currentUser = user;
        if (statusEl) statusEl.innerText = `Usuário: ${user.displayName || user.email}`;
        if (loginScreen) loginScreen.style.display = 'none';
        if (mainApp) mainApp.style.display = 'block';
        
        await loadUserData();
        init();
    } else {
        currentUser = null;
        database = {};
        if (loginScreen) loginScreen.style.display = 'block';
        if (mainApp) mainApp.style.display = 'none';
    }
});

// Login com suporte a Mobile (Redirect) e Desktop (Popup)
window.loginWithGoogle = function() {
    const provider = new GoogleAuthProvider();
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    if (isMobile) {
        signInWithRedirect(auth, provider).catch(error => {
            alert("Erro ao realizar login: " + error.message);
        });
    } else {
        signInWithPopup(auth, provider).catch(error => {
            if (error.code === 'auth/popup-blocked' || error.code === 'auth/popup-closed-by-user') {
                signInWithRedirect(auth, provider);
            } else {
                alert("Erro ao realizar login: " + error.message);
            }
        });
    }
};

window.logout = function() {
    signOut(auth);
};

async function saveData() { 
    if (!currentUser) return;
    try {
        await setDoc(doc(db, "users", currentUser.uid), {
            database: database,
            fundosPersonagens: fundosPersonagens
        });
    } catch (err) {
        console.error("Erro ao salvar dados no Firebase:", err);
        alert("Erro ao salvar alterações no banco de dados.");
    }
}

async function loadUserData() {
    try {
        const docRef = doc(db, "users", currentUser.uid);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            database = data.database || { "Chico Bento": [] };
            fundosPersonagens = data.fundosPersonagens || { "default": "" };
        } else {
            database = { "Chico Bento": [] };
            fundosPersonagens = { "default": "" };
            await saveData();
        }
    } catch (err) {
        console.error("Erro ao carregar dados do Firebase:", err);
        database = { "Chico Bento": [] };
    }
}

function init() { 
    const sheets = Object.keys(database);
    if (sheets.length === 0) {
        database["Minha Coleção"] = [];
        currentSheet = "Minha Coleção";
        saveData();
    } else if (!database[currentSheet]) {
        currentSheet = sheets[0];
    }
    editingIndex = null;
    updateSheetDropdown(); 
    updateCategoryFilterOptions();
    renderTable(); 
}

function updateSheetDropdown() {
    const select = document.getElementById('sheetSelect');
    if (!select) return;
    select.innerHTML = '';
    
    const sortedSheets = Object.keys(database).sort((a, b) => 
        a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
    );

    sortedSheets.forEach(sheet => {
        const option = document.createElement('option');
        option.value = sheet; 
        option.textContent = sheet;
        if (sheet === currentSheet) option.selected = true;
        select.appendChild(option);
    });

    const titleEl = document.getElementById('currentSheetTitle');
    if (titleEl) titleEl.innerText = "COLEÇÃO: " + currentSheet.toUpperCase();
}

function updateCategoryFilterOptions() {
    const filterSelect = document.getElementById('categoryFilter');
    if (!filterSelect) return;
    
    const selectedValue = filterSelect.value;
    filterSelect.innerHTML = '<option value="TODAS">Todas as Categorias</option>';

    if (!database[currentSheet]) return;

    const categorias = [...new Set(database[currentSheet].map(item => item.categoria ? item.categoria.trim() : ""))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

    categorias.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        filterSelect.appendChild(option);
    });

    filterSelect.value = categorias.includes(selectedValue) ? selectedValue : "TODAS";
}

window.createNewSheet = async function() {
    const name = prompt("Nome do Personagem/Lista:");
    if (name && !database[name]) {
        database[name] = []; 
        currentSheet = name;
        await saveData(); 
        init();
    } else if (database[name]) { 
        alert("Esta lista já existe!"); 
    }
};

window.deleteCurrentSheet = async function() {
    if (confirm(`Tem certeza que deseja excluir a lista "${currentSheet}"?`)) {
        delete database[currentSheet];
        delete fundosPersonagens[currentSheet];
        await saveData();
        
        const remaining = Object.keys(database);
        currentSheet = remaining.length > 0 ? remaining[0] : "";
        init();
    }
};

window.changeSheet = function() { 
    currentSheet = document.getElementById('sheetSelect').value; 
    
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';

    init(); 
};

// Faz o upload da capa para o Firebase Storage
async function uploadCapa(file) {
    if (!file || !currentUser) return "";
    try {
        const storageRef = ref(storage, `capas/${currentUser.uid}/${Date.now()}_${file.name}`);
        const snapshot = await uploadBytes(storageRef, file);
        return await getDownloadURL(snapshot.ref);
    } catch (err) {
        console.error("Erro ao enviar imagem:", err);
        alert("Erro ao salvar a capa da imagem.");
        return "";
    }
}

window.addGibi = async function(event) {
    event.preventDefault();
    const fileInput = document.getElementById('capaInput');
    let capaURL = "";

    if (fileInput && fileInput.files && fileInput.files[0]) {
        capaURL = await uploadCapa(fileInput.files[0]);
    }

    if (!database[currentSheet]) {
        database[currentSheet] = [];
    }

    database[currentSheet].push({
        capa: capaURL,
        editora: document.getElementById('editora').value,
        categoria: document.getElementById('categoria').value,
        serie: document.getElementById('serie').value,
        numero: parseInt(document.getElementById('numero').value) || 0,
        data: document.getElementById('data').value,
        estado: document.getElementById('estado').value
    });

    await saveData();
    updateCategoryFilterOptions();
    renderTable(); 
    document.getElementById('addGibiForm').reset();
};

window.deleteGibi = async function(index) {
    if (confirm("Remover este gibi?")) { 
        database[currentSheet].splice(index, 1); 
        if (editingIndex === index) editingIndex = null;
        await saveData(); 
        updateCategoryFilterOptions();
        renderTable(); 
    }
};

window.startEdit = function(index) { editingIndex = index; renderTable(); };
window.cancelEdit = function() { editingIndex = null; renderTable(); };

window.saveEdit = async function(index) {
    const fileInput = document.getElementById(`editCapa_${index}`);
    let capaURL = database[currentSheet][index].capa;

    if (fileInput && fileInput.files && fileInput.files[0]) {
        capaURL = await uploadCapa(fileInput.files[0]);
    }

    database[currentSheet][index] = {
        capa: capaURL,
        numero: parseInt(document.getElementById(`editNumero_${index}`).value) || 0,
        editora: document.getElementById(`editEditora_${index}`).value,
        categoria: document.getElementById(`editCategoria_${index}`).value,
        serie: document.getElementById(`editSerie_${index}`).value,
        data: document.getElementById(`editData_${index}`).value,
        estado: document.getElementById(`editEstado_${index}`).value
    };

    editingIndex = null;
    await saveData();
    updateCategoryFilterOptions();
    renderTable();
};

/* Modal de Zoom da Capa */
window.openImageModal = function(src) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('imgModalTarget');
    if (modal && modalImg) {
        modal.style.display = 'flex';
        modalImg.src = src;
    }
};

window.closeImageModal = function() {
    const modal = document.getElementById('imageModal');
    if (modal) modal.style.display = 'none';
};

/* Renderização e Pesquisa Avançada Multi-termo */
window.renderTable = function() {
    const tbody = document.getElementById('tableBody'); 
    if (!tbody) return;

    const selectedFilter = document.getElementById('categoryFilter') ? document.getElementById('categoryFilter').value : "TODAS";
    const searchInput = document.getElementById('searchInput');
    const rawSearch = searchInput ? searchInput.value.toLowerCase().trim() : "";

    tbody.innerHTML = '';

    if (!database[currentSheet]) return;

    let itemsToRender = [...database[currentSheet]];

    // 1. Filtro de Categoria
    if (selectedFilter !== "TODAS") {
        itemsToRender = itemsToRender.filter(item => item.categoria && item.categoria.trim() === selectedFilter);
    }

    // 2. Pesquisa Avançada Multi-termo
    if (rawSearch !== "") {
        const terms = rawSearch.split(/\s+/);

        itemsToRender = itemsToRender.filter(item => {
            const itemContent = [
                currentSheet,
                item.numero !== undefined && item.numero !== null ? item.numero.toString() : "",
                item.editora || "",
                item.categoria || "",
                item.serie || "",
                item.data || "",
                item.estado || ""
            ].join(" ").toLowerCase();

            return terms.every(term => itemContent.includes(term));
        });
    }

    if (editingIndex === null) {
        itemsToRender.sort((a, b) => a.numero - b.numero);
    }

    itemsToRender.forEach((item) => {
        const indexNoBanco = database[currentSheet].indexOf(item);
        
        if (editingIndex === indexNoBanco) {
            tbody.innerHTML += `<tr>
                <td class="capa-cell"><input type="file" id="editCapa_${indexNoBanco}" accept="image/*" style="font-size:10px; width:70px;"></td>
                <td><strong>${currentSheet}</strong></td>
                <td><input type="number" id="editNumero_${indexNoBanco}" value="${item.numero}"></td>
                <td><input type="text" id="editEditora_${indexNoBanco}" value="${item.editora}"></td>
                <td><input type="text" id="editCategoria_${indexNoBanco}" value="${item.categoria}"></td>
                <td><input type="text" id="editSerie_${indexNoBanco}" value="${item.serie}"></td>
                <td><input type="text" id="editData_${indexNoBanco}" value="${item.data}"></td>
                <td><input type="text" id="editEstado_${indexNoBanco}" value="${item.estado}"></td>
                <td class="actions-cell no-pdf">
                    <button class="btn-save" onclick="saveEdit(${indexNoBanco})">Salvar</button>
                    <button class="btn-cancel" onclick="cancelEdit()">X</button>
                </td>
            </tr>`;
        } else {
            const capaHTML = item.capa 
                ? `<img src="${item.capa}" class="capa-thumb" alt="Capa Nº ${item.numero}" onclick="openImageModal('${item.capa}')" title="Clique para ampliar">`
                : `<div class="capa-placeholder">Sem capa</div>`;

            tbody.innerHTML += `<tr>
                <td class="capa-cell">${capaHTML}</td>
                <td><strong>${currentSheet}</strong></td>
                <td class="numero-cell">Nº ${item.numero}</td>
                <td>${item.editora}</td>
                <td>${item.categoria}</td>
                <td>${item.serie}</td>
                <td>${item.data}</td>
                <td>${item.estado}</td>
                <td class="actions-cell no-pdf">
                    <button class="btn-edit" onclick="startEdit(${indexNoBanco})">Editar</button>
                    <button class="btn-delete" onclick="deleteGibi(${indexNoBanco})">Excluir</button>
                </td>
            </tr>`;
        }
    });
};

window.exportarBackup = function() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ database, fundosPersonagens }));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `backup_gibis_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
};

window.importarBackup = function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data.database) {
                database = data.database;
                if (data.fundosPersonagens) fundosPersonagens = data.fundosPersonagens;
                await saveData();
                init();
                alert("Backup restaurado com sucesso!");
            } else {
                alert("Arquivo de backup inválido.");
            }
        } catch (err) {
            alert("Erro ao ler o arquivo de backup.");
        }
    };
    reader.readAsText(file);
};

window.exportToPDF = function() {
    const element = document.getElementById('pdfContent');
    const actionCols = document.querySelectorAll('.no-pdf');
    
    actionCols.forEach(el => el.style.display = 'none');

    const opt = { 
        margin: 8, 
        filename: `Colecao_${currentSheet}.pdf`, 
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 }, 
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } 
    };

    html2pdf().set(opt).from(element).save().then(() => { 
        actionCols.forEach(el => el.style.display = ''); 
    });
};
