const readline = require('readline');
const http = require('http');

console.log(`
===========================================================
🤖 BARON'S SILLAGE CHATBOT YEREL TEST İSTEMCİSİ (CLI)
===========================================================
Çıkmak için 'exit' yazın.
Mesajınızı yazıp ENTER'a basın.
-----------------------------------------------------------
`);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const senderId = "test_user_deneme";

function askQuestion() {
  rl.question('\n👤 Siz: ', async (userText) => {
    if (userText.trim().toLowerCase() === 'exit') {
      console.log('Test sonlandırıldı.');
      rl.close();
      process.exit(0);
    }

    if (!userText.trim()) {
      askQuestion();
      return;
    }

    const payload = JSON.stringify({
      object: 'instagram',
      entry: [
        {
          messaging: [
            {
              sender: { id: senderId },
              message: { text: userText }
            }
          ]
        }
      ]
    });

    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/webhook/instagram',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log('🤖 Bot Yanıtı: İletildi (Konsol çıktılarını sunucu terminalinden görebilirsiniz)');
        askQuestion();
      });
    });

    req.on('error', (e) => {
      console.error('❌ Sunucuya bağlanılamadı. Lütfen sunucunun (npm run dev) açık olduğundan emin olun!');
      askQuestion();
    });

    req.write(payload);
    req.end();
  });
}

askQuestion();
