// --- CONFIGURATION ---
const API_URL = '/api';

// --- STATE ---
let currentUser = null;
let tempData = {};
let userProfile = null;
let userEntries = [];
let chartInstance = null;
let calorieChartInstance = null;
let savedApiKey = null;

// DOM Elements
const views = {
    auth: document.getElementById('authView'),
    guest: document.getElementById('guestView'),
    result: document.getElementById('resultView'),
    goal: document.getElementById('goalView'),
    app: document.getElementById('appView')
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. Check Login
    const storedUser = localStorage.getItem('bm_user');
    if (storedUser) {
        currentUser = JSON.parse(storedUser);
        checkBackendConnection(); 
    } else {
        switchView('auth');
    }

    checkApiKey();

    // UI Helpers
    const today = new Date().toISOString().split('T')[0];
    const logDateInput = document.getElementById('logDate');
    if(logDateInput) logDateInput.value = today;

    const targetWInput = document.getElementById('targetWeight');
    const targetDInput = document.getElementById('targetDate');
    if(targetWInput) targetWInput.addEventListener('input', handleWeightInput);
    if(targetDInput) targetDInput.addEventListener('change', checkScientificLimits);
});

// --- HELPER: CALCULATE AGE FROM DOB (NEW!) ---
function calculateAge(dobString) {
    if (!dobString) return 25; // Default if missing
    const birthDate = new Date(dobString);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return age;
}

// --- AUTHENTICATION ---
function toggleAuthMode() {
    const isRegister = document.querySelector('input[name="authType"]:checked').value === 'register';
    const btn = document.getElementById('authBtn');
    btn.textContent = isRegister ? "Create Account" : "Login";
}

document.getElementById('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = document.querySelector('input[name="authType"]:checked').value;
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    const msg = document.getElementById('authMsg');

    msg.textContent = "Processing...";

    try {
        const endpoint = mode === 'register' ? '/register' : '/login';
        const res = await fetch(`${API_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user, password: pass })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        if (mode === 'register') {
            alert("Account created! Please login.");
            document.querySelector('input[value="login"]').click();
            msg.textContent = "";
        } else {
            currentUser = { userId: data.userId, username: data.username };
            localStorage.setItem('bm_user', JSON.stringify(currentUser));
            msg.textContent = "";
            checkBackendConnection();
        }
    } catch (err) {
        msg.textContent = err.message;
        msg.style.color = "var(--danger)";
    }
});

function logout() {
    localStorage.removeItem('bm_user');
    currentUser = null;
    userProfile = null;
    userEntries = [];
    location.reload(); 
}

// --- SERVER COMMUNICATION ---
async function checkBackendConnection() {
    if(!currentUser) return;

    try {
        const res = await fetch(`${API_URL}/profile?userId=${currentUser.userId}`);
        const profileData = await res.json();

        if (profileData && profileData.goalWeight) {
            userProfile = profileData;
            const logRes = await fetch(`${API_URL}/logs?userId=${currentUser.userId}`);
            userEntries = await logRes.json();
            loadApp();
        } else {
            switchView('guest'); 
        }
    } catch (error) {
        console.error("Server Error:", error);
        alert("Server error. Check console.");
    }
}

async function saveProfileToServer(profile) {
    if(!currentUser) return;
    const payload = { ...profile, userId: currentUser.userId };
    try {
        await fetch(`${API_URL}/profile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (err) { alert("Failed to save profile."); }
}

async function addLogToServer(date, weight) {
    if(!currentUser) return;
    try {
        await fetch(`${API_URL}/logs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.userId, date, weight })
        });
        await refreshLogs(); 
    } catch (err) { alert("Failed to save log."); }
}

async function deleteLogFromServer(date) {
    if(!currentUser) return;
    try {
        await fetch(`${API_URL}/logs/${date}?userId=${currentUser.userId}`, {
            method: 'DELETE'
        });
        await refreshLogs();
    } catch (err) { alert("Failed to delete."); }
}

async function refreshLogs() {
    if(!currentUser) return;
    const res = await fetch(`${API_URL}/logs?userId=${currentUser.userId}`);
    userEntries = await res.json();
    updateDashboard();
}

// --- APP FLOW ---
function loadApp() {
    switchView('app');
    if(!document.getElementById('logoutBtn')) {
        const nav = document.querySelector('.nav-links');
        const btn = document.createElement('button');
        btn.className = 'nav-item';
        btn.id = 'logoutBtn';
        btn.innerHTML = '<i class="ph ph-sign-out"></i> Logout';
        btn.onclick = logout;
        nav.appendChild(btn);
    }
    updateDashboard();
    
    // Fill settings with current data
    if(userProfile) {
        document.getElementById('editHeight').value = userProfile.height;
        document.getElementById('editActivity').value = userProfile.activity;
        document.getElementById('editDiet').value = userProfile.diet;
    }
}

function switchView(viewName) {
    Object.values(views).forEach(el => {
        if(el) el.classList.add('hidden');
    });
    if(views[viewName]) views[viewName].classList.remove('hidden');
}

function goBackToGuest() { switchView('guest'); }

function showGoalSetup() {
    document.getElementById('targetWeight').value = tempData.ibw;
    const event = new Event('input');
    document.getElementById('targetWeight').dispatchEvent(event);
    switchView('goal');
}

// --- FORMS & ACTIONS ---

// Guest Calculator (UPDATED for DOB)
document.getElementById('guestForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const gender = document.querySelector('input[name="gender"]:checked').value;
    
    // NEW: Get DOB instead of Age
    const dob = document.getElementById('guestDOB').value;
    const age = calculateAge(dob); // Calculate age dynamically

    const height = parseFloat(document.getElementById('guestHeight').value);
    const weight = parseFloat(document.getElementById('guestWeight').value);
    const activity = parseFloat(document.getElementById('guestActivity').value);
    
    const stats = calculateStats(weight, height, gender);
    const tdee = calculateTDEE(weight, height, age, gender, activity);
    
    // Save DOB in temp data
    tempData = { gender, dob, height, weight, activity, ...stats };
    
    document.getElementById('resBMI').textContent = stats.bmi;
    document.getElementById('resStatus').textContent = stats.status;
    document.getElementById('resStatus').style.color = stats.color;
    document.getElementById('bmiRing').style.borderTopColor = stats.color;
    document.getElementById('resIBW').textContent = `${stats.ibw} kg`;
    document.getElementById('resTDEE').textContent = `${Math.round(tdee)} kcal`;
    
    switchView('result');
});

// Goal Setup (UPDATED for DOB)
document.getElementById('goalForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const goalWeight = parseFloat(document.getElementById('targetWeight').value);
    const goalDate = document.getElementById('targetDate').value;
    const startDate = new Date().toISOString().split('T')[0];
    
    userProfile = {
        gender: tempData.gender, 
        dob: tempData.dob, // Save DOB
        height: tempData.height, 
        activity: tempData.activity,
        diet: 'balanced', 
        goalWeight: goalWeight, 
        goalDate: goalDate, 
        startDate: startDate, 
        startWeight: tempData.weight
    };

    await saveProfileToServer(userProfile);
    await addLogToServer(startDate, tempData.weight); 

    loadApp();
});

document.getElementById('logForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const w = parseFloat(document.getElementById('logWeight').value);
    const d = document.getElementById('logDate').value;
    await addLogToServer(d, w);
    document.getElementById('logWeight').value = '';
    alert('Logged successfully!');
});

async function updateProfile() {
    const h = parseFloat(document.getElementById('editHeight').value);
    const act = parseFloat(document.getElementById('editActivity').value);
    const diet = document.getElementById('editDiet').value;
    
    if(h > 50 && h < 300) {
        userProfile.height = h; 
        userProfile.activity = act; 
        userProfile.diet = diet; 
        await saveProfileToServer(userProfile);
        updateDashboard(); 
        alert('Profile updated');
    }
}

async function resetAllData() {
    if(confirm('Warning: This will PERMANENTLY delete your profile and weight logs from the cloud. \n\n(Your account "Pratap" will stay, but you will restart the setup).')) {
        
        if(currentUser) {
            try {
                // Call the new Nuke route
                await fetch(`${API_URL}/nuke?userId=${currentUser.userId}`, { method: 'DELETE' });
            } catch (err) {
                console.error("Delete failed", err);
            }
        }

        localStorage.removeItem('geminiApiKey');
        logout(); // This reloads the page
    }
}

// --- DASHBOARD LOGIC ---

function updateDashboard() {
    if(!userEntries.length) return;
    
    const sorted = [...userEntries].sort((a, b) => new Date(a.date) - new Date(b.date));
    const latest = sorted[sorted.length - 1];
    
    const stats = calculateStats(latest.weight, userProfile.height, userProfile.gender);
    document.getElementById('dashBMI').textContent = stats.bmi;
    document.getElementById('dashStatus').textContent = stats.status;
    document.getElementById('dashStatus').style.color = stats.color;
    document.getElementById('dashTarget').textContent = `${userProfile.goalWeight} kg`;
    document.getElementById('dashIBW').textContent = stats.ibw;
    
    const gap = (latest.weight - userProfile.goalWeight).toFixed(1);
    const gapText = gap > 0 ? `Lose ${gap} kg` : `Gain ${Math.abs(gap)} kg`;
    document.getElementById('dashGap').textContent = gapText;
    
    const today = new Date();
    const target = new Date(userProfile.goalDate);
    const diff = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
    document.getElementById('dashDays').textContent = diff > 0 ? `${diff} days left` : 'Goal date passed';
    
    // Calculate Age Dynamically
    const currentAge = calculateAge(userProfile.dob);

    const maintenance = calculateTDEE(latest.weight, userProfile.height, currentAge, userProfile.gender, userProfile.activity);
    let dailyDeficit = 0;
    
    if (gap > 0 && diff > 0) {
        const totalCaloriesToBurn = gap * 7700;
        dailyDeficit = totalCaloriesToBurn / diff;
    } else if (gap < 0 && diff > 0) {
        const totalCaloriesToGain = Math.abs(gap) * 7700;
        dailyDeficit = -(totalCaloriesToGain / diff);
    }
    
    let targetIntake = Math.round(maintenance - dailyDeficit);
    if (targetIntake < 1200) targetIntake = 1200; 
    
    const macros = calculateMacros(targetIntake, userProfile.diet);
    document.getElementById('valP').textContent = macros.p;
    document.getElementById('valC').textContent = macros.c;
    document.getElementById('valF').textContent = macros.f;
    
    renderChart(sorted);
    renderCalorieChart(Math.round(maintenance), targetIntake);
    renderLogTable();
}

function renderLogTable() {
    const tableBody = document.getElementById('logTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    
    const sortedEntries = [...userEntries].sort((a, b) => new Date(b.date) - new Date(a.date));

    sortedEntries.forEach((entry) => {
        const stats = calculateStats(entry.weight, userProfile.height, userProfile.gender);
        const tr = document.createElement('tr');
        
        tr.innerHTML = `
            <td>${new Date(entry.date).toLocaleDateString('en-GB')}</td>
            <td><b>${entry.weight} kg</b></td>
            <td><span style="color: ${stats.color}">${stats.status}</span></td>
            <td>
                <button class="btn-delete" onclick="deleteEntry('${entry.date}')" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer;">
                    <i class="ph ph-trash" style="font-size:1.1rem;"></i>
                </button>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}

function deleteEntry(date) {
    if(confirm('Delete this log entry?')) {
        deleteLogFromServer(date);
    }
}

// --- VISUALIZATION (No Changes) ---
function renderChart(sortedData) {
    const ctx = document.getElementById('weightChart');
    if(!ctx) return;
    const labels = sortedData.map(e => { const d = new Date(e.date); return `${d.getDate()}/${d.getMonth()+1}`; });
    const data = sortedData.map(e => e.weight);
    if (chartInstance) chartInstance.destroy();
    Chart.defaults.color = '#A0A0A0'; Chart.defaults.borderColor = '#333';
    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Weight (kg)', data: data, borderColor: '#2DD4BF', backgroundColor: 'rgba(45, 212, 191, 0.1)', borderWidth: 2, pointBackgroundColor: '#121212', pointBorderColor: '#2DD4BF', pointBorderWidth: 2, tension: 0.4, fill: true
            }, {
                label: 'Goal', data: Array(labels.length).fill(userProfile.goalWeight), borderColor: '#10B981', borderDash: [5, 5], borderWidth: 1, pointRadius: 0, fill: false
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'bottom' } }, scales: { y: { grid: { color: '#333' } }, x: { grid: { display: false } } } }
    });
}

function renderCalorieChart(maintenance, target) {
    const ctx = document.getElementById('calorieChart');
    if(!ctx) return;
    document.getElementById('calTarget').textContent = target;
    document.getElementById('calMaint').textContent = maintenance + ' kcal';
    document.getElementById('calDeficit').textContent = (maintenance - target) + ' kcal';
    if (calorieChartInstance) calorieChartInstance.destroy();
    const deficitVal = Math.max(0, maintenance - target);
    calorieChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Target Intake', 'Deficit'],
            datasets: [{ data: [target, deficitVal], backgroundColor: ['#2DD4BF', '#333333'], borderWidth: 0, hoverOffset: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '80%', plugins: { legend: { display: false }, tooltip: { enabled: false } } }
    });
}

// --- MATH & HELPERS (Unchanged) ---
function calculateTDEE(weight, height, age, gender, activity) {
    let bmr = (10 * weight) + (6.25 * height) - (5 * age);
    if(gender === 'male') bmr += 5; else bmr -= 161;
    return bmr * activity;
}
function calculateMacros(calories, dietType) {
    let p, c, f; 
    switch(dietType) {
        case 'high-protein': p = 0.30; c = 0.35; f = 0.35; break;
        case 'keto': p = 0.25; c = 0.05; f = 0.70; break;
        case 'low-fat': p = 0.25; c = 0.55; f = 0.20; break;
        case 'balanced': default: p = 0.20; c = 0.50; f = 0.30;
    }
    return {
        p: Math.round((calories * p) / 4),
        c: Math.round((calories * c) / 4),
        f: Math.round((calories * f) / 9)
    };
}
function calculateStats(weight, height, gender) {
    const heightM = height / 100;
    const bmi = (weight / (heightM * heightM)).toFixed(1);
    let status = 'Normal', color = '#10B981';
    if(bmi < 18.5) { status = 'Underweight'; color = '#F59E0B'; }
    else if(bmi >= 25 && bmi < 30) { status = 'Overweight'; color = '#F59E0B'; }
    else if(bmi >= 30) { status = 'Obese'; color = '#EF4444'; }
    const heightInches = height / 2.54;
    const inchesOver60 = heightInches - 60;
    let ibw = 0;
    if (inchesOver60 <= 0) { ibw = gender === 'male' ? 50 : 45.5; } 
    else { const base = gender === 'male' ? 50 : 45.5; ibw = base + (2.3 * inchesOver60); }
    return { bmi, status, color, ibw: ibw.toFixed(1) };
}
function handleWeightInput(e) {
    const targetW = parseFloat(e.target.value);
    if (!targetW || !tempData.weight) return;
    const diff = Math.abs(targetW - tempData.weight);
    if (diff === 0) return;
    const weeksNeeded = diff / 1.0; 
    const daysNeeded = Math.ceil(weeksNeeded * 7);
    const future = new Date();
    future.setDate(future.getDate() + daysNeeded);
    document.getElementById('targetDate').value = future.toISOString().split('T')[0];
    checkScientificLimits();
}
function checkScientificLimits() {
    const targetW = parseFloat(document.getElementById('targetWeight').value);
    const targetD = document.getElementById('targetDate').value;
    const warningBox = document.getElementById('goalWarning');
    const warningText = document.getElementById('warningText');
    if (!targetW || !targetD || !tempData.weight) return;
    const diff = Math.abs(targetW - tempData.weight);
    const today = new Date();
    const goalDate = new Date(targetD);
    const timeDiff = goalDate - today;
    const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
    const weeksDiff = daysDiff / 7;
    if (weeksDiff <= 0) {
        warningBox.classList.remove('hidden');
        warningText.textContent = "Please select a future date.";
        return;
    }
    const rate = diff / weeksDiff;
    if (rate > 2.0) {
        warningBox.classList.remove('hidden');
        warningText.textContent = `Extreme Pace: ${rate.toFixed(1)}kg/week!`;
    } else {
        warningBox.classList.add('hidden');
    }
}
function checkApiKey() {
    savedApiKey = localStorage.getItem('geminiApiKey');
    const setupSection = document.getElementById('apiKeySection');
    const generatorSection = document.getElementById('dietGenerator');
    if (savedApiKey) {
        setupSection.classList.add('hidden');
        generatorSection.classList.remove('hidden');
    } else {
        setupSection.classList.remove('hidden');
        generatorSection.classList.add('hidden');
    }
}
function saveApiKey() {
    const key = document.getElementById('geminiKey').value.trim();
    if (key.length > 20) { localStorage.setItem('geminiApiKey', key); checkApiKey(); } else { alert("Please enter a valid API Key."); }
}
function clearApiKey() {
    localStorage.removeItem('geminiApiKey'); document.getElementById('geminiKey').value = ''; alert("API Key removed."); checkApiKey(); switchTab('tab-diet');
}
async function generateDietPlan() {
    if (!userProfile) return;
    const latestWeight = userEntries[userEntries.length - 1].weight;
    // Note: AI Prompt needs Age. We calculate it here.
    const currentAge = calculateAge(userProfile.dob);
    const maintenance = calculateTDEE(latestWeight, userProfile.height, currentAge, userProfile.gender, userProfile.activity);
    const gap = latestWeight - userProfile.goalWeight;
    let targetIntake = Math.round(maintenance);
    if (gap > 0) targetIntake -= 500; else targetIntake += 300;
    if (targetIntake < 1200) targetIntake = 1200;
    const macros = calculateMacros(targetIntake, userProfile.diet);
    const resultsArea = document.getElementById('dietResults');
    const loader = document.getElementById('dietLoading');
    resultsArea.innerHTML = '';
    loader.classList.remove('hidden');
    const prompt = `You are an expert nutritionist. Create a 7-day diet plan. Stats: ${latestWeight}kg, Goal: ${userProfile.goalWeight}kg. Target: ${targetIntake} kcal/day. Diet: ${userProfile.diet}. Macros: ${macros.p}g Protein, ${macros.c}g Carbs, ${macros.f}g Fats. RETURN ONLY RAW HTML. Use this structure for 7 days: <div class="day-card"><h3>Day X</h3><div class="meal-row"><strong>Breakfast</strong> Meal - Cals</div><div class="meal-row"><strong>Lunch</strong> Meal - Cals</div><div class="meal-row"><strong>Dinner</strong> Meal - Cals</div><div class="meal-row"><strong>Snack</strong> Meal - Cals</div></div>`;
    const selectedModel = document.getElementById('modelSelector').value;
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${savedApiKey}`;
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
        const data = await response.json();
        if (response.status === 429) throw new Error("Speed Limit Hit!");
        if (data.error) throw new Error(data.error.message);
        const aiText = data.candidates[0].content.parts[0].text;
        resultsArea.innerHTML = aiText.replace(/```html/g, '').replace(/```/g, '');
        document.getElementById('dietSubtitle').textContent = `Target: ${targetIntake} kcal | ${userProfile.diet.toUpperCase()}`;
    } catch (error) {
        resultsArea.innerHTML = `<div class="card" style="border: 1px solid var(--danger); color: var(--danger);"><h3>Error</h3><p>${error.message}</p></div>`;
    } finally { loader.classList.add('hidden'); }
}
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const selectedTab = document.getElementById(tabId);
    if(selectedTab) selectedTab.classList.add('active');
    const btn = Array.from(document.querySelectorAll('.nav-item')).find(b => b.getAttribute('onclick').includes(tabId));
    if(btn) btn.classList.add('active');
    if(tabId === 'tab-analytics') { updateDashboard(); }
}