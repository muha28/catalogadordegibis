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

// Persistência local do Firebase Auth
setPersistence(auth, browserLocalPersistence).catch(console.error);

let fundosPersonagens = { "default": "" };
let database = {};
let currentSheet = "";
let editingIndex = null;
let currentUser = null;

/**
 * Converte e comprime imagens enviadas para Base64 (otimizado para o limite de 1MB do documento do Firestore)
 */
function imageToBase64(file, maxWidth = 300) {
    return new Promise((resolve, reject) => {
        if (!file) return resolve("");
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

                // Converte em JPEG comprimido (~20-40KB por capa)
                resolve(canvas.toDataURL('image/jpeg', 0.65));
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
}

// 1. Processa retorno de redirecionamentos do login do Google
getRedirectResult(auth)
    .then((result) => {
        if (result && result.user) {
            console.log("Login via redirect concluído com sucesso:", result.user);
        }
    })
    .catch((error) => {
        console.error("Erro no retorno do redirect:", error);
    });

// 2. Observador de Estado de Autenticação
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

// 3. Funções Globais de Autenticação
window.loginWithGoogle = async function() {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.warn("Popup falhou/bloqueado. Tentando via Redirect:", error);
        if (error.code === 'auth/popup-blocked' || error.code === 'auth/popup-closed-by-user') {
            try {
                await signInWithRedirect(auth, provider);
            } catch (redirectError) {
                alert("Erro ao autenticar: " + redirectError.message);
            }
        } else if (error.code !== 'auth/cancelled-popup-request') {
            alert("Erro ao realizar login: " + error.message);
        }
    }
};

window.logout = function() {
    signOut(auth);
};

// 4. Operações de Banco de Dados (Firestore)
async function saveData() { 
    if (!currentUser) return;
    try {
        await setDoc(doc(db, "users", currentUser.uid), {
            database: database,
            fundosPersonagens: fundosPersonagens
        });
    } catch (err) {
        console.error("Erro ao salvar no Firebase:", err);
        alert("Erro ao salvar alterações. O arquivo pode ter ultrapassado o limite máximo suportado.");
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
        console.error("Erro ao carregar dados:", err);
        database = { "Chico Bento": [] };
    }
}

// 5. Inicialização e Atualização de Interface
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

// 6. Manipulação de Listas/Coleções
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

// 7. Manipulação dos Items (Gibis)
window.addGibi = async function(event) {
    event.preventDefault();
    const submitBtn = event.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
        const fileInput = document.getElementById('capaInput');
        let capaURL = "";

        if (fileInput && fileInput.files && fileInput.files[0]) {
            capaURL = await imageToBase64(fileInput.files[0]);
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
    } catch (err) {
        console.error("Erro ao adicionar gibi:", err);
        alert("Erro ao adicionar o gibi. Verifique o console.");
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

window.startEdit = function(index) { 
    editingIndex = index; 
    renderTable(); 
};

window.cancelEdit = function() { 
    editingIndex = null; 
    renderTable(); 
};

window.saveEdit = async function(index) {
    const fileInput = document.getElementById(`editCapa_${index}`);
    let capaURL = database[currentSheet][index].capa;

    if (fileInput && fileInput.files && fileInput.files[0]) {
        capaURL = await imageToBase64(fileInput.files[0]);
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

// 8. Modal de Imagem
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

// 9. Renderização da Tabela
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

    // Ordena por número se não estiver no modo edição
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

            // Preenche os inputs após a inserção no DOM
            setTimeout(() => {
                const elNum = tr.querySelector(`#editNumero_${indexNoBanco}`);
                const elEd = tr.querySelector(`#editEditora_${indexNoBanco}`);
                const elCat = tr.querySelector(`#editCategoria_${indexNoBanco}`);
                const elSer = tr.querySelector(`#editSerie_${indexNoBanco}`);
                const elData = tr.querySelector(`#editData_${indexNoBanco}`);
                const elEst = tr.querySelector(`#editEstado_${indexNoBanco}`);

                if (elNum) elNum.value = item.numero;
                if (elEd) elEd.value = item.editora || '';
                if (elCat) elCat.value = item.categoria || '';
                if (elSer) elSer.value = item.serie || '';
                if (elData) elData.value = item.data || '';
                if (elEst) elEst.value = item.estado || '';
            }, 0);

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

// 10. Funções do Backup JSON (Completo para TODAS as listas)
window.exportarBackup = function() {
    if (!database || Object.keys(database).length === 0) {
        alert("Não há dados para exportar.");
        return;
    }

    // Exporta o objeto completo 'database' contendo todas as listas/coleções
    const backupData = JSON.stringify({ database, fundosPersonagens }, null, 2);
    const blob = new Blob([backupData], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const downloadAnchor = document.createElement('a');
    downloadAnchor.href = url;
    downloadAnchor.download = `backup_completo_catalogador_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    
    downloadAnchor.remove();
    URL.revokeObjectURL(url);
};

window.importarBackup = function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data && data.database) {
                database = data.database;
                if (data.fundosPersonagens) {
                    fundosPersonagens = data.fundosPersonagens;
                }
                
                // Salva o banco restaurado no Firestore
                await saveData();

                // Define a lista visível para a primeira existente no novo banco
                const sheets = Object.keys(database);
                currentSheet = sheets.length > 0 ? sheets[0] : "";

                init();
                alert("Backup de TODAS as listas foi restaurado com sucesso!");
            } else {
                alert("Arquivo de backup inválido. A chave 'database' não foi encontrada.");
            }
        } catch (err) {
            console.error(err);
            alert("Erro ao ler o arquivo de backup. Verifique se é um arquivo JSON válido.");
        }
    };
    reader.readAsText(file);
};

// 11. Exportação para PDF (Gera o PDF da lista atual)
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

    if (window.html2pdf) {
        window.html2pdf().set(opt).from(element).save().then(() => { 
            actionCols.forEach(el => el.style.display = ''); 
        });
    } else {
        alert("A biblioteca html2pdf não foi encontrada na página.");
        actionCols.forEach(el => el.style.display = '');
    }
};
