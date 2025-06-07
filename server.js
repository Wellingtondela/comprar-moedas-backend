const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { admin, db } = require('./firebaseConfig');
require('dotenv').config();


const app = express();
const port = process.env.PORT || 3000;

const fetch = global.fetch;
const mpAccessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;

app.use(cors());
app.use(bodyParser.json());

app.get('/', (req, res) => {
  res.send('✅ Backend está rodando - Compra de Moedas via Pix');
});

// ✅ ROTA: Criar pagamento Pix para compra de moedas
app.post('/criar-pagamento', async (req, res) => {
  const { uid, moedas, preco } = req.body;

  if (!uid || !moedas || !preco) {
    return res.status(400).json({ erro: 'uid, moedas e preco são obrigatórios.' });
  }

  try {
    const idempotencyKey = Date.now().toString();

    const response = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mpAccessToken}`,
        'X-Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({
        transaction_amount: parseFloat(preco),
        description: `Compra de ${moedas} moedas`,
        payment_method_id: 'pix',
        payer: {
          email: `${uid}@moedas.com`,
          first_name: 'Usuário',
          last_name: uid
        },
        external_reference: JSON.stringify({ uid, moedas, preco })
      })
    });

    const data = await response.json();

    if (!data.point_of_interaction) {
      console.error('❌ Erro no pagamento:', data);
      return res.status(500).json({ erro: 'Erro ao gerar pagamento Pix.' });
    }

    res.json({
      qr_code_base64: data.point_of_interaction.transaction_data.qr_code_base64,
      copia_cola: data.point_of_interaction.transaction_data.qr_code,
      payment_id: data.id
    });

  } catch (error) {
    console.error('❌ Erro ao criar pagamento:', error);
    res.status(500).json({ erro: 'Erro interno ao criar pagamento.' });
  }
});

// ✅ WEBHOOK para confirmar compra de moedas
// ✅ WEBHOOK para confirmar compra de moedas
app.post('/webhook', async (req, res) => {
  const data = req.body;

  try {
    if (data.type === 'payment' && data.data?.id) {
      const paymentId = data.data.id;

      const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
          Authorization: `Bearer ${mpAccessToken}`
        }
      });

      const payment = await response.json();

      if (payment.status === 'approved') {
        const { external_reference, transaction_amount } = payment;

        let info = { uid: '', moedas: 0, preco: 0 };
        try {
          info = JSON.parse(external_reference);
        } catch (e) {
          console.warn('⚠️ Erro ao converter external_reference:', e);
        }

        // Recupera o documento do usuário
        const userRef = db.collection('usuarios').doc(info.uid);
        const userDoc = await userRef.get();

        let moedasAtuais = 0;

        if (userDoc.exists) {
          const dados = userDoc.data();
          moedasAtuais = dados.moedas || 0;
        }

        const novasMoedas = moedasAtuais + parseInt(info.moedas);

        // Atualiza a quantidade de moedas
        await userRef.set({ moedas: novasMoedas }, { merge: true });

        console.log(`✅ ${info.moedas} moedas adicionadas para o usuário ${info.uid}. Total: ${novasMoedas}`);
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Erro no webhook:', error);
    res.sendStatus(500);
  }
});

// ✅ ROTA: Verificar status do pagamento
app.get('/status-pagamento/:id', async (req, res) => {
  const paymentId = req.params.id;

  if (!paymentId) {
    return res.status(400).json({ erro: 'ID do pagamento é obrigatório.' });
  }

  try {
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${mpAccessToken}` }
    });

    const data = await response.json();

    if (!data || data.error) {
      return res.status(404).json({ erro: 'Pagamento não encontrado.' });
    }

    res.json({ status: data.status });
  } catch (error) {
    console.error('❌ Erro ao verificar pagamento:', error);
    res.status(500).json({ erro: 'Erro ao verificar pagamento.' });
  }
});

app.listen(port, () => {
  console.log(`✅ Servidor rodando na porta ${port}`);
});
