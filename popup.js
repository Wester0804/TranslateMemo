// popup.js
document.addEventListener('DOMContentLoaded', function() {
    const sourceText = document.getElementById('sourceText');
    const translation = document.getElementById('translation');
    const saveButton = document.getElementById('saveTranslation');
    const openManagerButton = document.getElementById('openManager');
    const highlightToggle = document.getElementById('highlightToggle');
    const wordCountEl = document.getElementById('wordCount');
    const todayCountEl = document.getElementById('todayCount');
    const resultEl = document.getElementById('result');
    const resultText = document.getElementById('resultText');
    
    // 載入統計資訊
    loadStats();
    
    // 載入設定
    loadSettings();
    
    // 檢查是否有選取的文字
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {action: 'getSelectedText'}, function(response) {
            if (response && response.text) {
                sourceText.value = response.text;
                // 檢查是否已有翻譯
                checkExistingTranslation(response.text);
            }
        });
    });
    
    // 儲存翻譯
    saveButton.addEventListener('click', function() {
        const source = sourceText.value.trim();
        const trans = translation.value.trim();
        
        if (!source || !trans) {
            showResult('請輸入原文和翻譯', 'error');
            return;
        }
        
        saveTranslation(source, trans);
    });
    
    // 開啟管理頁面
    openManagerButton.addEventListener('click', function() {
        chrome.tabs.create({
            url: chrome.runtime.getURL('manager.html')
        });
    });
    
    // 標記功能開關
    highlightToggle.addEventListener('change', function() {
        const enabled = highlightToggle.checked;
        chrome.storage.sync.set({highlightEnabled: enabled}, function() {
            // 通知所有標籤頁更新標記狀態
            chrome.tabs.query({}, function(tabs) {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'toggleHighlight',
                        enabled: enabled
                    });
                });
            });
        });
    });
    
    // 載入統計資訊
    function loadStats() {
        chrome.storage.local.get(['translations', 'todayTranslations'], function(result) {
            const translations = result.translations || {};
            const todayTranslations = result.todayTranslations || {};
            const today = new Date().toDateString();
            
            wordCountEl.textContent = Object.keys(translations).length;
            todayCountEl.textContent = todayTranslations[today] || 0;
        });
    }
    
    // 載入設定
    function loadSettings() {
        chrome.storage.sync.get(['highlightEnabled'], function(result) {
            highlightToggle.checked = result.highlightEnabled !== false;
        });
    }
    
    // 檢查現有翻譯
    function checkExistingTranslation(text) {
        chrome.storage.local.get(['translations'], function(result) {
            const translations = result.translations || {};
            const normalizedText = text.toLowerCase().trim();
            
            for (const [key, value] of Object.entries(translations)) {
                if (key.toLowerCase() === normalizedText) {
                    translation.value = value.translation;
                    showResult('找到現有翻譯', 'info');
                    break;
                }
            }
        });
    }
    
    // 儲存翻譯
    function saveTranslation(source, trans) {
        const translationData = {
            translation: trans,
            timestamp: Date.now(),
            count: 1
        };
        
        chrome.storage.local.get(['translations', 'todayTranslations'], function(result) {
            const translations = result.translations || {};
            const todayTranslations = result.todayTranslations || {};
            const today = new Date().toDateString();
            const normalizedSource = source.toLowerCase().trim();
            
            // 如果已存在，增加計數
            if (translations[normalizedSource]) {
                translations[normalizedSource].count++;
                translations[normalizedSource].timestamp = Date.now();
            } else {
                translations[normalizedSource] = translationData;
                // 更新今日翻譯計數
                todayTranslations[today] = (todayTranslations[today] || 0) + 1;
            }
            
            // 儲存到本地存儲
            chrome.storage.local.set({
                translations: translations,
                todayTranslations: todayTranslations
            }, function() {
                showResult('翻譯已儲存！', 'success');
                loadStats();
                
                // 通知所有標籤頁更新標記
                chrome.tabs.query({}, function(tabs) {
                    tabs.forEach(tab => {
                        chrome.tabs.sendMessage(tab.id, {
                            action: 'updateTranslations',
                            translations: translations
                        });
                    });
                });
            });
        });
    }
    
    // 顯示結果訊息
    function showResult(message, type) {
        resultText.textContent = message;
        resultEl.className = `result ${type}`;
        resultEl.style.display = 'block';
        
        // 3秒後隱藏
        setTimeout(() => {
            resultEl.style.display = 'none';
        }, 3000);
    }
});