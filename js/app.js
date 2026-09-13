/* ==========================================================================
   APP.JS - LÓGICA PRINCIPAL DO CATALOGADOR DE GIBIS (COMPLETO)
   ========================================================================== */

// Estrutura global em memória
window.database = window.database || {};
window.currentSheet = window.currentSheet || null;
window.editingIndex = null;

/* ==========================================================================
   1. RENDERIZAÇÃO DA TABELA E CONTADORES
   ========================================================================== */
window.renderTable = function() {
    const tbody = document.getElementById('tableBody'); 
    if (!tbody) return;

    // --- LÓGICA DOS CONTADORES RECENTEMENTE ADICIONADA ---
    const listCounterEl = document.getElementById('listCounter');
    const totalCounterEl = document.getElementById('totalCounter');

    // Quantidade na lista/personagem atual
    const countCurrentList = (window.database && window.currentSheet && window.database[window.currentSheet]) 
        ? window.database[window.currentSheet].length 
        : 0;

    // Quantidade total somando todas as listas
    const countTotalAll = window.database 
        ? Object.values(window.database).reduce((acc, list) => acc + (Array.isArray(list) ? list.length : 0), 0) 
        : 0;

    if (listCounterEl) listCounterEl.textContent = countCurrentList;
    if (totalCounterEl) totalCounterEl.textContent = countTotalAll;
    // -----------------------------------------------------

    const searchInput = document.getElementById('searchInput');
    const categoryFilter = document.getElementById('categoryFilter');
    
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const selectedCategory = categoryFilter ? categoryFilter.value : 'TODAS';

    tbody.innerHTML = '';

    if (!window.currentSheet || !window.database[window.currentSheet]) {
        return;
    }

    const currentList = window.database[window.currentSheet];

    // Filtragem dos itens (Busca + Categoria)
    const filteredItems = currentList.map((gibi, originalIndex) => ({ gibi, originalIndex }))
        .filter(({ gibi }) => {
            const matchSearch = !searchTerm || 
                (gibi.editora && gibi.editora.toLowerCase().includes(searchTerm)) ||
                (gibi.categoria && gibi.categoria.toLowerCase().includes(searchTerm)) ||
                (gibi.serie && gibi.serie.toLowerCase().includes(searchTerm)) ||
                (gibi.numero && gibi.numero.toString().includes(searchTerm));

            const matchCategory = selectedCategory === 'TODAS' || gibi.categoria === selectedCategory;

            return matchSearch && matchCategory;
        });

    filteredItems.forEach(({ gibi, originalIndex }) => {
        const tr = document.createElement('tr');

        // Se a linha estiver em modo de edição
        if (window.editingIndex === originalIndex) {
            tr.innerHTML = `
                <td class="capa-cell">
                    <input type="file" id="editCapaInput" accept="image/*" style="width: 100px;">
                </td>
                <td>${window.currentSheet}</td>
                <td><input type="number" id="editNumero" value="${gibi.numero || ''}"></td>
                <td><input type="text" id="editEditora" value="${gibi.editora || ''}"></td>
                <td><input type="text" id="editCategoria" value="${gibi.categoria || ''}"></td>
                <td><input type="text" id="editSerie" value="${gibi.serie || ''}"></td>
                <td><input type="text" id="editData" value="${gibi.data || ''}"></td>
                <td><input type="text" id="editEstado" value="${gibi.estado || ''}"></td>
                <td class="no-pdf actions-cell">
                    <button type="button" class="btn-save" onclick="window.saveGibi(${originalIndex})">💾</button>
                    <button type="button" class="btn-cancel" onclick="window.cancelEdit()">❌</button>
                </td>
            `;
        } else {
            // Renderização padrão
            const capaHtml = gibi.capa 
                ? `<img src="${gibi.capa}" class="capa-thumb" alt="Capa" onclick="window.openImageModal('${gibi.capa}')">`
                : `<div class="capa-placeholder">Sem Capa</div>`;

            tr.innerHTML = `
                <td class="capa-cell">${capaHtml}</td>
                <td>${window.currentSheet}</td>
                <td class="numero-cell">Nº ${gibi.numero || '-'}</td>
                <td>${gibi.editora || '-'}</td>
                <td>${gibi.categoria || '-'}</td>
                <td>${gibi.serie || '-'}</td>
                <td>${gibi.data || '-'}</td>
                <td>${gibi.estado || '-'}</td>
                <td class="no-pdf actions-cell">
                    <button type="button" class="btn-edit" onclick="window.startEdit(${originalIndex})">✏️</button>
                    <button type="button" class="btn-delete" onclick="window.deleteGibi(${originalIndex})">🗑️</button>
                </td>
            `;
        }

        tbody.appendChild(tr);
    });
};

/* ==========================================================================
   2. GERENCIAMENTO DE LISTAS (PERSONAGENS / SHEETS)
   ========================================================================== */
window.updateSheetSelect = function() {
    const select = document.getElementById('sheetSelect');
    if (!select) return;

    const sheets = Object.keys(window.database);
    select.innerHTML = '<option value="">-- Selecione um Personagem --</option>';

    sheets.forEach(sheet => {
        const option = document.createElement('option');
        option.value = sheet;
        option.textContent = sheet;
        select.appendChild(option);
    });

    if (window.currentSheet && sheets.includes(window.currentSheet)) {
        select.value = window.currentSheet;
    }
};

window.changeSheet = function() {
    const select = document.getElementById('sheetSelect');
    if (!select) return;

    window.currentSheet = select.value;
    window.editingIndex = null;
    
    const titleEl = document.getElementById('currentSheetTitle');
    if (titleEl) {
        titleEl.textContent = `COLEÇÃO: ${window.currentSheet ? window.currentSheet.toUpperCase() : 'SELECIONE UM PERSONAGEM'}`;
    }

    window.updateCategoryFilterOptions();
    window.renderTable();
};

window.createNewSheet = function() {
    const name = prompt('Digite o nome do novo personagem/lista:');
    if (!name) return;

    const cleanName = name.trim();
    if (!cleanName) return;

    if (!window.database[cleanName]) {
        window.database[cleanName] = [];
        window.currentSheet = cleanName;
        window.updateSheetSelect();
        window.changeSheet();
        window.saveToFirebase(); // Sincroniza se o Firebase estiver ativo
    } else {
        alert('Esta lista já existe!');
    }
};

window.deleteCurrentSheet = function() {
    if (!window.currentSheet) {
        alert('Nenhuma lista selecionada!');
        return;
    }

    if (confirm(`Tem certeza que deseja excluir a lista "${window.currentSheet}" e todos os seus gibis?`)) {
        delete window.database[window.currentSheet];
        window.currentSheet = null;
        window.updateSheetSelect();
        window.changeSheet();
        window.saveToFirebase();
    }
};

/* ==========================================================================
   3. FILTROS DE CATEGORIA
   ========================================================================== */
window.updateCategoryFilterOptions = function() {
    const categoryFilter = document.getElementById('categoryFilter');
    if (!categoryFilter || !window.currentSheet || !window.database[window.currentSheet]) return;

    const currentList = window.database[window.currentSheet];
    const categories = new Set();

    currentList.forEach(gibi => {
        if (gibi.categoria && gibi.categoria.trim() !== '') {
            categories.add(gibi.categoria.trim());
        }
    });

    const currentValue = categoryFilter.value;
    categoryFilter.innerHTML = '<option value="TODAS">Todas as Categorias</option>';

    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        categoryFilter.appendChild(option);
    });

    if (categories.has(currentValue)) {
        categoryFilter.value = currentValue;
    } else {
        categoryFilter.value = 'TODAS';
    }
};

/* ==========================================================================
   4. OPERAÇÕES CRUD (ADICIONAR, EDITAR, SALVAR, EXCLUIR GIBIS)
   ========================================================================== */
window.addGibi = function(event) {
    if (event) event.preventDefault();

    if (!window.currentSheet) {
        alert('Por favor, selecione ou crie uma lista de personagem primeiro!');
        return;
    }

    const editora = document.getElementById('editora')?.value || '';
    const categoria = document.getElementById('categoria')?.value || '';
    const serie = document.getElementById('serie')?.value || '';
    const numero = document.getElementById('numero')?.value || '';
    const data = document.getElementById('data')?.value || '';
    const estado = document.getElementById('estado')?.value || '';
    const capaInput = document.getElementById('capaInput');

    const processAdd = (capaBase64 = '') => {
        const novoGibi = { editora, categoria, serie, numero, data, estado, capa: capaBase64 };

        if (!window.database[window.currentSheet]) {
            window.database[window.currentSheet] = [];
        }

        window.database[window.currentSheet].push(novoGibi);

        const form = document.getElementById('addGibiForm');
        if (form) form.reset();

        window.updateCategoryFilterOptions();
        window.renderTable();
        window.saveToFirebase();
    };

    if (capaInput && capaInput.files && capaInput.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => processAdd(e.target.result);
        reader.readAsDataURL(capaInput.files[0]);
    } else {
        processAdd();
    }
};

window.startEdit = function(index) {
    window.editingIndex = index;
    window.renderTable();
};

window.cancelEdit = function() {
    window.editingIndex = null;
    window.renderTable();
};

window.saveGibi = function(index) {
    if (!window.currentSheet || !window.database[window.currentSheet][index]) return;

    const gibi = window.database[window.currentSheet][index];
    const editCapaInput = document.getElementById('editCapaInput');

    gibi.numero = document.getElementById('editNumero')?.value || gibi.numero;
    gibi.editora = document.getElementById('editEditora')?.value || gibi.editora;
    gibi.categoria = document.getElementById('editCategoria')?.value || gibi.categoria;
    gibi.serie = document.getElementById('editSerie')?.value || gibi.serie;
    gibi.data = document.getElementById('editData')?.value || gibi.data;
    gibi.estado = document.getElementById('editEstado')?.value || gibi.estado;

    const processSave = (capaBase64 = null) => {
        if (capaBase64 !== null) {
            gibi.capa = capaBase64;
        }
        window.editingIndex = null;
        window.updateCategoryFilterOptions();
        window.renderTable();
        window.saveToFirebase();
    };

    if (editCapaInput && editCapaInput.files && editCapaInput.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => processSave(e.target.result);
        reader.readAsDataURL(editCapaInput.files[0]);
    } else {
        processSave(null);
    }
};

window.deleteGibi = function(index) {
    if (!window.currentSheet || !window.database[window.currentSheet]) return;

    if (confirm('Deseja realmente remover este gibi?')) {
        window.database[window.currentSheet].splice(index, 1);
        window.updateCategoryFilterOptions();
        window.renderTable();
        window.saveToFirebase();
    }
};

/* ==========================================================================
   5. UTILITÁRIOS (MODAL, IMPRESSÃO/PDF E DROPDOWNS)
   ========================================================================== */
window.openImageModal = function(src) {
    const modal = document.getElementById('imageModal');
    const target = document.getElementById('imgModalTarget');
    if (modal && target) {
        target.src = src;
        modal.style.display = 'flex';
    }
};

window.closeImageModal = function() {
    const modal = document.getElementById('imageModal');
    if (modal) {
        modal.style.display = 'none';
    }
};

window.toggleDropdown = function() {
    const dropdown = document.getElementById('settingsDropdown');
    if (dropdown) {
        dropdown.classList.toggle('show');
    }
};

window.exportToPDF = function() {
    window.print();
};

/* ==========================================================================
   6. PERSISTÊNCIA FIREBASE (MOCK / PLACEHOLDER PARA CONFIGURAÇÃO REAL)
   ========================================================================== */
window.saveToFirebase = function() {
    // Se a instância do Firebase Firestore/Realtime Database estiver ativa no seu firebase.js:
    if (window.firebaseDb && window.currentUser) {
        window.firebaseDb.ref('users/' + window.currentUser.uid + '/database').set(window.database);
    }
};

/* ==========================================================================
   7. INICIALIZAÇÃO E EVENT LISTENERS
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    // Listener de busca em tempo real
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', () => window.renderTable());
    }

    // Listener do filtro por categoria
    const categoryFilter = document.getElementById('categoryFilter');
    if (categoryFilter) {
        categoryFilter.addEventListener('change', () => window.renderTable());
    }

    // Listener do formulário de inserção
    const addGibiForm = document.getElementById('addGibiForm');
    if (addGibiForm) {
        addGibiForm.addEventListener('submit', window.addGibi);
    }

    // Fechar dropdowns ao clicar fora
    window.addEventListener('click', (event) => {
        if (!event.target.matches('.btn-settings')) {
            const dropdowns = document.getElementsByClassName('dropdown-content');
            for (let i = 0; i < dropdowns.length; i++) {
                const openDropdown = dropdowns[i];
                if (openDropdown.classList.contains('show')) {
                    openDropdown.classList.remove('show');
                }
            }
        }
    });

    // Renderização inicial
    window.updateSheetSelect();
    window.renderTable();
});
