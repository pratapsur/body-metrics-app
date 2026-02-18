const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs'); // <--- New Tool for Security
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- Database Connection ---
const dbURI = process.env.MONGO_URI; 
mongoose.connect(dbURI)
    .then(() => console.log('✅ MongoDB Connected Successfully'))
    .catch(err => console.log('❌ MongoDB Connection Error:', err));

// --- 1. USER SCHEMA (New!) ---
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

// --- 2. DATA SCHEMAS (Updated with Owner) ---
const entrySchema = new mongoose.Schema({
    userId: String, // <--- Links data to a specific user
    date: String,
    weight: Number
});
const Entry = mongoose.model('Entry', entrySchema);

const profileSchema = new mongoose.Schema({
    userId: String,
    gender: String, 
    dob: String, // <--- NEW: Stores "2000-05-15"
    height: Number, 
    activity: Number,
    diet: String, goalWeight: Number, goalDate: String, startDate: String, startWeight: Number
});
const Profile = mongoose.model('Profile', profileSchema);

// --- AUTH ROUTES (Login/Register) ---

// REGISTER
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // 1. Check if user exists
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ error: "Username already taken" });

        // 2. Encrypt Password
        const hashedPassword = await bcrypt.hash(password, 10);

        // 3. Save User
        const newUser = new User({ username, password: hashedPassword });
        await newUser.save();
        
        res.json({ message: "User created successfully" });
    } catch (err) {
        res.status(500).json({ error: "Error registering user" });
    }
});

// LOGIN
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // 1. Find User
        const user = await User.findOne({ username });
        if (!user) return res.status(400).json({ error: "User not found" });

        // 2. Check Password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: "Invalid credentials" });

        // 3. Return the User ID (This is our "Key")
        res.json({ userId: user._id, username: user.username });
    } catch (err) {
        res.status(500).json({ error: "Error logging in" });
    }
});

// --- DATA ROUTES (Protected by userId) ---

// Get Logs (Only for the specific user)
app.get('/api/logs', async (req, res) => {
    const { userId } = req.query; // Client sends ?userId=123
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    
    try { const logs = await Entry.find({ userId }); res.json(logs); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

// Add Log (Tag it with userId)
app.post('/api/logs', async (req, res) => {
    try { const newEntry = new Entry(req.body); await newEntry.save(); res.json(newEntry); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete Log (Must match date AND userId)
app.delete('/api/logs/:date', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try { await Entry.findOneAndDelete({ date: req.params.date, userId }); res.json({ message: "Deleted" }); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

// Get Profile
app.get('/api/profile', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try { const profile = await Profile.findOne({ userId }); res.json(profile || {}); } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

// Update Profile
app.post('/api/profile', async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try { 
        // Delete old profile for THIS user only
        await Profile.deleteMany({ userId }); 
        const newProfile = new Profile(req.body); 
        await newProfile.save(); 
        res.json(newProfile); 
    } 
    catch (err) { res.status(500).json({ error: err.message }); }
});

// --- NEW ROUTE: Nuke User Data (But keep the account) ---
app.delete('/api/nuke', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
        // Delete Profile AND all Logs for this user
        await Profile.deleteMany({ userId });
        await Entry.deleteMany({ userId });
        await User.findByIdAndDelete(userId);
        
        res.json({ message: "User data nuked successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- NEW ROUTE: AI Diet Generator ---
// --- DEBUGGING ROUTE: AI Diet Generator ---
app.post('/api/generate-diet', async (req, res) => {
    console.log("1. Received diet request from frontend."); 

    try {
        const { prompt } = req.body;
        const apiKey = process.env.GEMINI_API_KEY;

        // Check if Render actually gave us the key
        if (!apiKey) {
            console.error("CRITICAL: GEMINI_API_KEY is missing/undefined in Environment Variables!");
            return res.status(500).json({ error: "Server Config Error: API Key missing." });
        }
        console.log(`2. API Key found (First 4 chars): ${apiKey.substring(0, 4)}...`);

        // Use the safest, most standard model
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`;
        
        console.log("3. Sending request to Google...");

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        console.log(`4. Google Status: ${response.status} ${response.statusText}`);

        const data = await response.json();

        // IF GOOGLE FAILED, LOG THE EXACT ERROR
        if (!response.ok) {
            console.error("❌ GOOGLE API ERROR DETAILS:", JSON.stringify(data, null, 2));
            throw new Error(data.error?.message || `Google refused: ${response.statusText}`);
        }

        console.log("5. Success! Sending data to frontend.");
        res.json(data);

    } catch (err) {
        console.error("❌ FINAL SERVER ERROR:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- Catch-All Route ---
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});