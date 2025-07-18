// content.js
let translations = {};
let highlightEnabled = true;
let highlightedElements = new Set();

// 初始化
init();

function init() {
    loadTranslations();
    loadSettings();
    
    // 監聽來自 popup 的消息
    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        switch(request.action) {
            case 'getSelectedText':
                sendResponse({text: getSelectedText()});
                break;
            case 'updateTranslations':
                translations = request.translations;
                highlightTranslations();
                break;
            case 'toggleHighlight':
                highlightEnabled = request.enabled;
                if (highlightEnabled) {
                    highlightTranslations();
                } else {
                    removeHighlights();
                }
                break;
        }
    });
    
    // 監聽頁面變化
    const observer = new MutationObserver(function(mutations) {
        if (highlightEnabled) {
            highlightTranslations();
        }
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// 載入翻譯資料
function loadTranslations() {
    chrome.storage.local.get(['translations'], function(result) {
        translations = result.translations || {};
        if (highlightEnabled) {
            highlightTranslations();
        }
    });
}

// 載入設定
function loadSettings() {
    chrome.storage.sync.get(['highlightEnabled'], function(result) {
        highlightEnabled = result.highlightEnabled !== false;
        if (highlightEnabled) {
            highlightTranslations();
        }
    });
}

// 獲取選取的文字
function getSelectedText() {
    const selection = window.getSelection();
    return selection.toString().trim();
}

// 標記翻譯
function highlightTranslations() {
    if (!highlightEnabled || Object.keys(translations).length === 0) {
        return;
    }
    
    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                // 跳過已標記的元素
                if (node.parentElement && node.parentElement.classList.contains('translation-highlight')) {
                    return NodeFilter.FILTER_REJECT;
                }
                // 跳過 script 和 style 標籤
                const tagName = node.parentElement.tagName.toLowerCase();
                if (tagName === 'script' || tagName === 'style') {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );
    
    const textNodes = [];
    let node;
    
    while (node = walker.nextNode()) {
        textNodes.push(node);
    }
    
    textNodes.forEach(textNode => {
        highlightTextNode(textNode);
    });
}

// 標記文字節點
function highlightTextNode(textNode) {
    let text = textNode.textContent;
    let hasMatch = false;
    
    // 創建匹配模式
    const words = Object.keys(translations);
    if (words.length === 0) return;
    
    // 按長度排序，優先匹配較長的詞彙
    words.sort((a, b) => b.length - a.length);
    
    for (const word of words) {
        const regex = new RegExp(escapeRegExp(word), 'gi');
        if (regex.test(text)) {
            hasMatch = true;
            break;
        }
    }
    
    if (!hasMatch) return;
    
    // 創建替換的 HTML
    let newHTML = text;
    
    for (const word of words) {
        const regex = new RegExp(escapeRegExp(word), 'gi');
        newHTML = newHTML.replace(regex, function(match) {
            const translation = translations[word.toLowerCase()];
            return `<span class="translation-highlight" 
                          data-original="${match}" 
                          data-translation="${translation.translation}"
                          title="${match} → ${translation.translation}">
                        ${match}
                    </span>`;
        });
    }
    
    if (newHTML !== text) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = newHTML;
        
        // 替換原始文字節點
        const parent = textNode.parentNode;
        while (wrapper.firstChild) {
            parent.insertBefore(wrapper.firstChild, textNode);
        }
        parent.removeChild(textNode);
    }
}

// 移除所有標記
function removeHighlights() {
    const highlights = document.querySelectorAll('.translation-highlight');
    highlights.forEach(highlight => {
        const parent = highlight.parentNode;
        parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
        parent.normalize();
    });
}

// 轉義正規表達式特殊字符
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 添加工具提示功能
document.addEventListener('mouseover', function(e) {
    if (e.target.classList.contains('translation-highlight')) {
        showTooltip(e.target, e);
    }
});

document.addEventListener('mouseout', function(e) {
    if (e.target.classList.contains('translation-highlight')) {
        hideTooltip();
    }
});

let tooltip = null;

function showTooltip(element, event) {
    const original = element.getAttribute('data-original');
    const translation = element.getAttribute('data-translation');
    
    if (tooltip) {
        hideTooltip();
    }
    
    tooltip = document.createElement('div');
    tooltip.className = 'translation-tooltip';
    tooltip.innerHTML = `
        <div class="tooltip-content">
            <div class="tooltip-original">${original}</div>
            <div class="tooltip-translation">${translation}</div>
        </div>
    `;
    
    document.body.appendChild(tooltip);
    
    // 定位工具提示
    const rect = element.getBoundingClientRect();
    tooltip.style.left = rect.left + window.scrollX + 'px';
    tooltip.style.top = rect.bottom + window.scrollY + 5 + 'px';
}

function hideTooltip() {
    if (tooltip) {
        tooltip.remove();
        tooltip = null;
    }
}