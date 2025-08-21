const admin = require('firebase-admin');
const axios = require('axios');

// Environment variable থেকে load
if (!process.env.FIREBASE_SERVICE) throw new Error("Missing FIREBASE_SERVICE env variable");
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE);

if (!process.env.BOT_TOKEN) throw new Error("Missing BOT_TOKEN env variable");
const BOT_TOKEN = process.env.BOT_TOKEN;

// Firebase initialize
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// Cache for status
const lastStatusMap = {}; // { docId: "pending"/"approved"/"rejected" }

// Timestamp format
function formatTime(timestamp) {
  if (timestamp && timestamp.seconds) {
    return new Date(timestamp.seconds*1000).toLocaleString('en-GB', {timeZone:'Asia/Dhaka'});
  }
  return new Date().toLocaleString('en-GB', {timeZone:'Asia/Dhaka'});
}

// Telegram message
async function sendTelegramMessage(chatId, message) {
  try {
    const res = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: message
    });
    console.log('✅ Telegram response ok:', res.data.ok);
  } catch(err) {
    console.error('❌ Telegram error:', err.response?.data || err.message);
  }
}

// Event processor
async function processEvent(data, docId, isWithdraw=false) {
  const { status, method, amount, trxId } = data;
  if(!['pending','approved','rejected'].includes(status)) return;

  const number = data.Number || data.number || 'N/A';
  const customId = data.id || docId;

  const snap = await db.collection('musers').where('payment','==',method).get();
  if(snap.empty) return;

  const manager = snap.docs[0].data();
  const chatId = manager.chatId;
  if(!chatId) return;

  let title = '';
  if(isWithdraw){
    title = status==='pending'?'📤 New Withdraw Request':status==='approved'?'📤 Withdraw Approved':'📤 Withdraw Rejected';
  } else {
    title = status==='pending'?'📥 New Deposit Request':status==='approved'?'📥 Deposit Approved':'📥 Deposit Rejected';
  }

  let msg = `${title}\nid: ${customId}\nAmount: ${amount}\nNumber: ${number}`;
  if(!isWithdraw || status==='approved') msg += `\nTrxId: ${trxId||'N/A'}`;
  msg += `\nMethod: ${method}\nTime: ${formatTime(data.createdAt)}`;

  await sendTelegramMessage(chatId, msg);
}

// Deposit listener
db.collection('depositRequests').onSnapshot(snap=>{
  snap.docChanges().forEach(change=>{
    const data = change.doc.data();
    const id = change.doc.id;

    if(change.type==='added'){
      processEvent(data,id,false);
      lastStatusMap[id] = data.status;
    } else if(change.type==='modified'){
      const prev = lastStatusMap[id];
      if(prev!==data.status){
        processEvent(data,id,false);
        lastStatusMap[id] = data.status;
      }
    }
  });
});

// Withdraw listener
db.collection('withdrawRequests').onSnapshot(snap=>{
  snap.docChanges().forEach(change=>{
    const data = change.doc.data();
    const id = change.doc.id;

    if(change.type==='added'){
      processEvent(data,id,true);
      lastStatusMap[id] = data.status;
    } else if(change.type==='modified'){
      const prev = lastStatusMap[id];
      if(prev!==data.status){
        processEvent(data,id,true);
        lastStatusMap[id] = data.status;
      }
    }
  });
});

console.log('🚀 Bot running with debug logs...');
