import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getAuth, 
    signInWithPopup, 
    signInWithRedirect, 
    getRedirectResult, 
    GoogleAuthProvider, 
    signOut, 
    onAuthStateChanged,
    setPersistence,
    browserLocalPersistence
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

// Força a persistência local da sessão
setPersistence(auth, browserLocalPersistence).catch(console.error);

let fundosPersonagens = { "default": "" };
let database = {};
let currentSheet = "";
let editingIndex = null;
let currentUser = null;
let isHandlingRedirect = false;

// Função auxiliar para redimensionar imagens e economizar espaço
function compressImage(file, maxWidth = 600) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    resolve(blob || file);
                }, 'image/jpeg', 0.85);
            };
            img.onerror = () => resolve(file);
        };
        reader.onerror = () => resolve(file);
    });
}

// 1. Processa o retorno do login por redirecionamento caso ocorra
async function checkRedirectResult() {
    isHandlingRedirect = true;
    try {
        const result = await getRedirectResult(auth);
        if (result && result.user) {
            console.log("Login via redirect concluído com sucesso:", result.user);
        }
    } catch (error) {
        console.error("Erro no retorno do login via redirect:", error);
        if (error.code !== 'auth/popup-closed-by-user') {
            alert("Erro na autenticação: " + error.message);
        }
    } finally {
        isHandlingRedirect = false;
    }
}

// Inicia checagem de redirect imediatamente
checkRedirectResult();

// 2. Monitor do estado do Usuário (Sessão)
onAuthStateChanged(auth, async (user) => {
    // Evita recarregar a tela enquanto o redirect do Google ainda está processando
    if (isHandlingRedirect) return;

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

// 3. Login com tratamento resiliente para Mobile
window.loginWithGoogle = async function() {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    try {
        // Tenta popup primeiro em todas as plataformas (o comportamento padrão moderno e estável)
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.warn("Popup falhou ou foi bloqueado. Tentando via Redirect...", error);
        // Se o popup for explicitamente bloqueado pelo navegador mobile, recorre ao redirect
        if (error.code === 'auth/popup-blocked' || error.code === 'auth/popup-closed-by-user') {
            try {
                await signInWithRedirect(auth, provider);
            } catch (redirectError) {
                alert("Erro ao redirecionar para o login: " + redirectError.message);
            }
        } else {
            alert("Erro ao realizar login: " + error.message);
        }
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
    if (name && name.trim() !== "") {
        const cleanName = name.trim();
        if (!database[cleanName]) {
            database[cleanName] = []; 
            currentSheet = cleanName;
            await saveData(); 
            init();
        } else { 
            alert("Esta lista já existe!"); 
        }
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

async function uploadCapa(file) {
    if (!file || !currentUser) return "";
    try {
        const compressedFile = await compressImage(file);
        const storageRef = ref(storage, `capas/${currentUser.uid}/${Date.now()}_${file.name.replace(/\s+/g, '_')}`);
        const snapshot = await uploadBytes(storageRef, compressedFile);
        return await getDownloadURL(snapshot.ref);
    } catch (err) {
        console.error("Erro ao enviar imagem:", err);
        alert("Erro ao salvar a capa da imagem.");
        return "";
    }
}

window.addGibi = async function(event) {
    event.preventDefault();
    const submitBtn = event.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
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
            editora: document.getElementById('editora').value.trim(),
            categoria: document.getElementById('categoria').value.trim(),
            serie: document.getElementById('serie').value.trim(),
            numero: parseInt(document.getElementById('numero').value) || 0,
            data: document.getElementById('data').value.trim(),
            estado: document.getElementById('estado').value.trim()
        });

        await saveData();
        updateCategoryFilterOptions();
        renderTable(); 
        document.getElementById('addGibiForm').reset();
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
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
        editora: document.getElementById(`editEditora_${index}`).value.trim(),
        categoria: document.getElementById(`editCategoria_${index}`).value.trim(),
        serie: document.getElementById(`editSerie_${index}`).value.trim(),
        data: document.getElementById(`editData_${index}`).value.trim(),
        estado: document.getElementById(`editEstado_${index}`).value.trim()
    };

    editingIndex = null;
    await saveData();
    updateCategoryFilterOptions();
    renderTable();
};

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

window.renderTable = function() {
    const tbody = document.getElementById('tableBody'); 
    if (!tbody) return;

    const selectedFilter = document.getElementById('categoryFilter') ? document.getElementById('categoryFilter').value : "TODAS";
    const searchInput = document.getElementById('searchInput');
    const rawSearch = searchInput ? searchInput.value.toLowerCase().trim() : "";

    tbody.innerHTML = '';

    if (!database[currentSheet]) return;

    let itemsToRender = [...database[currentSheet]];

    if (selectedFilter !== "TODAS") {
        itemsToRender = itemsToRender.filter(item => item.categoria && item.categoria.trim() === selectedFilter);
    }

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
        const tr = document.createElement('tr');

        if (editingIndex === indexNoBanco) {
            tr.innerHTML = `
                <td class="capa-cell"><input type="file" id="editCapa_${indexNoBanco}" accept="image/*" style="font-size:10px; width:70px;"></td>
                <td><strong>${currentSheet}</strong></td>
                <td><input type="number" id="editNumero_${indexNoBanco}"></td>
                <td><input type="text" id="editEditora_${indexNoBanco}"></td>
                <td><input type="text" id="editCategoria_${indexNoBanco}"></td>
                <td><input type="text" id="editSerie_${indexNoBanco}"></td>
                <td><input type="text" id="editData_${indexNoBanco}"></td>
                <td><input type="text" id="editEstado_${indexNoBanco}"></td>
                <td class="actions-cell no-pdf">
                    <button class="btn-save" onclick="saveEdit(${indexNoBanco})">Salvar</button>
                    <button class="btn-cancel" onclick="cancelEdit()">X</button>
                </td>
            `;

            tr.querySelector(`#editNumero_${indexNoBanco}`).value = item.numero;
            tr.querySelector(`#editEditora_${indexNoBanco}`).value = item.editora || '';
            tr.querySelector(`#editCategoria_${indexNoBanco}`).value = item.categoria || '';
            tr.querySelector(`#editSerie_${indexNoBanco}`).value = item.serie || '';
            tr.querySelector(`#editData_${indexNoBanco}`).value = item.data || '';
            tr.querySelector(`#editEstado_${indexNoBanco}`).value = item.estado || '';

        } else {
            const tdCapa = document.createElement('td');
            tdCapa.className = 'capa-cell';

            if (item.capa) {
                const img = document.createElement('img');
                img.src = item.capa;
                img.className = 'capa-thumb';
                img.alt = `Capa Nº ${item.numero}`;
                img.title = 'Clique para ampliar';
                img.onclick = () => openImageModal(item.capa);
                tdCapa.appendChild(img);
            } else {
                const div = document.createElement('div');
                div.className = 'capa-placeholder';
                div.textContent = 'Sem capa';
                tdCapa.appendChild(div);
            }

            const tdPersonagem = document.createElement('td');
            tdPersonagem.innerHTML = `<strong>${currentSheet}</strong>`;

            const tdNumero = document.createElement('td');
            tdNumero.className = 'numero-cell';
            tdNumero.textContent = `Nº ${item.numero}`;

            const tdEditora = document.createElement('td');
            tdEditora.textContent = item.editora || '';

            const tdCategoria = document.createElement('td');
            tdCategoria.textContent = item.categoria || '';

            const tdSerie = document.createElement('td');
            tdSerie.textContent = item.serie || '';

            const tdData = document.createElement('td');
            tdData.textContent = item.data || '';

            const tdEstado = document.createElement('td');
            tdEstado.textContent = item.estado || '';

            const tdActions = document.createElement('td');
            tdActions.className = 'actions-cell no-pdf';
            tdActions.innerHTML = `
                <button class="btn-edit" onclick="startEdit(${indexNoBanco})">Editar</button>
                <button class="btn-delete" onclick="deleteGibi(${indexNoBanco})">Excluir</button>
            `;

            tr.appendChild(tdCapa);
            tr.appendChild(tdPersonagem);
            tr.appendChild(tdNumero);
            tr.appendChild(tdEditora);
            tr.appendChild(tdCategoria);
            tr.appendChild(tdSerie);
            tr.appendChild(tdData);
            tr.appendChild(tdEstado);
            tr.appendChild(tdActions);
        }

        tbody.appendChild(tr);
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
