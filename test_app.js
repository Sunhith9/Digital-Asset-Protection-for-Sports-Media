
const document = {
    getElementById: function(id) {
        if (id === 'similarity-threshold') return { value: '10' };
        if (id === 'scan-results-container') return { innerHTML: '' };
        return null;
    }
};
let scanFileContainer = { name: 'test.jpg' };

function renderScanResults(matches) {
    const container = document.getElementById('scan-results-container');
    const thresholdAmount = document.getElementById('similarity-threshold').value;

    if (!matches || matches.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding:3rem; background:rgba(16, 185, 129, 0.05); border:1px solid rgba(16, 185, 129, 0.2); border-radius:12px;">
                <i class="fa-solid fa-shield-check" style="font-size:3rem; color:var(--success); margin-bottom:1rem;"></i>
                <h3 style="color:var(--success); margin-bottom:0.5rem;">Authentic & Safe</h3>
                <p style="color:var(--text-muted); font-size:0.85rem;">No violations found. The media does not match any protected assets within the threshold of ${thresholdAmount}.</p>
            </div>
        `;
        return;
    }

    const resultsHtml = matches.map(m => {
        // Hamming distance max is 64 for a 64-bit hash. Convert to percentage.
        const matchPercentage = Math.round((1 - (m.distance / 64)) * 100);
        
        let riskColor = 'var(--info)';
        let riskLabel = 'LOW THREAT LEVEL';
        let riskIcon = 'fa-solid fa-circle-info';
        
        if (matchPercentage >= 90) {
            riskColor = 'var(--danger)';
            riskLabel = 'CRITICAL THREAT LEVEL';
            riskIcon = 'fa-solid fa-radiation';
        } else if (matchPercentage >= 75) {
            riskColor = 'var(--warning)';
            riskLabel = 'HIGH THREAT LEVEL';
            riskIcon = 'fa-solid fa-triangle-exclamation';
        } else if (matchPercentage >= 50) {
            riskColor = '#eab308'; // Yellow
            riskLabel = 'MODERATE THREAT LEVEL';
            riskIcon = 'fa-solid fa-shield-halved';
        }

        return `
        <div style="display:flex; gap:16px; padding:16px; border:1px solid ${riskColor}; border-radius:12px; margin-bottom:12px; background:rgba(0, 0, 0, 0.1); box-shadow: 0 4px 15px rgba(0,0,0,0.2), inset 0 0 15px ${riskColor}15; animation: slideUp 0.3s ease-out;">
            <div style="position:relative;">
                <img src="${m.asset.thumbnail || m.asset.url}" style="width:70px; height:70px; border-radius:6px; object-fit:cover; border:1px solid rgba(255,255,255,0.1);">
                <div style="position:absolute; top:-8px; right:-8px; background:${riskColor}; color:white; font-size:0.6rem; font-weight:bold; padding:2px 6px; border-radius:10px; box-shadow:0 2px 5px rgba(0,0,0,0.5);">ALERT</div>
            </div>
            <div style="flex:1;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div>
                        <div style="font-weight:700; font-size:1.05rem; color:white; margin-bottom:4px;">${m.asset.filename || 'Protected Asset'}</div>
                        <div style="font-size:0.75rem; font-family:'Outfit'; font-weight:800; color:${riskColor}; text-transform:uppercase; letter-spacing:0.05em;"><i class="${riskIcon}"></i> ${riskLabel}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:1.5rem; font-weight:800; font-family:'Outfit'; color:${riskColor}; line-height:1; text-shadow: 0 0 10px ${riskColor}40;">${matchPercentage}%</div>
                        <div style="font-size:0.65rem; color:var(--text-dim); text-transform:uppercase;">Similarity Match</div>
                    </div>
                </div>
                
                <div style="margin-top:12px; margin-bottom:4px;">
                    <div style="display: flex; justify-content: space-between; font-size: 0.65rem; color: var(--text-dim); text-transform: uppercase; margin-bottom: 4px;">
                        <span>Threat Severity Meter</span>
                    </div>
                    <div style="width: 100%; height: 6px; background: rgba(0,0,0,0.3); border-radius: 3px; overflow: hidden; border: 1px solid var(--glass-border);">
                        <div style="width: ${matchPercentage}%; height: 100%; background: ${riskColor}; border-radius: 3px; box-shadow: 0 0 8px ${riskColor};"></div>
                    </div>
                </div>

                <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top:12px;">
                    <div style="font-size:0.75rem; color:var(--text-muted); background:rgba(0,0,0,0.2); padding:6px 10px; border-radius:4px; display:inline-block;">
                        <span>Raw Distance Score: <strong>${m.distance}</strong></span>
                        <span style="margin:0 8px; color:var(--glass-border);">|</span>
                        <span>Threshold: <strong>${thresholdAmount}</strong></span>
                    </div>
                    <button class="btn secondary" style="font-size: 0.75rem; padding: 6px 12px; background: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.3); color: var(--accent-primary);" onclick="openDMCAModal('${scanFileContainer.name}', '${m.asset.filename || 'Protected Asset'}', ${matchPercentage})"><i class="fa-solid fa-scale-balanced"></i> Generate Legal Notice</button>
                </div>
            </div>
        </div>
    `}).join('');

    container.innerHTML = `
        <div style="margin-bottom:1.5rem; padding-bottom:1rem; border-bottom:1px solid var(--glass-border);">
            <div style="color:var(--danger); font-weight:700; font-family:'Outfit'; font-size:1.2rem;">${matches.length} Infringement(s) Located</div>
            <p style="font-size:0.8rem; color:var(--text-dim); margin-top:4px;">The uploaded media strongly matches the following protected assets in your repository.</p>
        </div>
        ${resultsHtml}
    `;
}

const matches = [
    { distance: 5, asset: { url: 'http', filename: 'test' } }
];
try {
    renderScanResults(matches);
    console.log('SUCCESS');
} catch (e) {
    console.error('ERROR:', e.message);
}
