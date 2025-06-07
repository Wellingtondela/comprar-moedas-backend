const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const admin = require('./firebaseConfig');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const fetch = global.fetch;
const mpAccessToken = process.env.MP_ACCESS_TOKEN;

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
app.post('/webhook', async (req, res) => {
  const data = req.body;

  try {
    if (data.type === 'payment' && data.data?.id) {
      const paymentId = data.data.id;

      const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${mpAccessToken}` }
      });

      const payment = await response.json();

      if (payment.status === 'approved') {
        let info = {};
        try {
          info = JSON.parse(payment.external_reference);
        } catch (e) {
          console.warn('⚠️ Erro ao interpretar external_reference:', e);
        }

        await admin.db.collection('compras_moedas').add({
          uid: info.uid,
          moedas: info.moedas,
          preco: info.preco,
          status: payment.status,
          payment_id: payment.id,
          data_pagamento: new Date()
        });

        console.log(`✅ Compra confirmada - ${info.moedas} moedas para ${info.uid}`);
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Erro no webhook:', error);
    res.sendStatus(500);
  }
});

app.listen(port, () => {
  console.log(`✅ Servidor rodando na porta ${port}`);
});
