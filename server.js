const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const admin = require('./firebaseConfig');
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
app.post("/webhook", async (req, res) => {
  console.log("Webhook recebido:", JSON.stringify(req.body));

  // Ajuste aqui conforme estrutura do webhook do Mercado Pago
  // Geralmente os dados estão em req.body.data.object
  const payment = req.body.data?.object;

  if (!payment) {
    console.log("Pagamento não encontrado no webhook");
    return res.sendStatus(400);
  }

  // Verifica status de pagamento
  if (payment.status === "approved" || payment.status === "paid") {
    const paymentId = payment.id;
    // Você deve garantir que uid e moedas estão no metadata do pagamento
    const uid = payment.metadata?.uid;
    const moedas = parseInt(payment.metadata?.moedas);

    if (!uid || !moedas) {
      console.log("UID ou moedas ausentes no metadata do pagamento");
      return res.sendStatus(400);
    }

    try {
      // Salvar compra
      await db.collection("comprasMoedas").add({
        uid,
        moedas,
        paymentId,
        dataCompra: admin.firestore.FieldValue.serverTimestamp(),
        status: "pago"
      });

      // Atualizar saldo do usuário com transação
      const userRef = db.collection("usuarios").doc(uid);
      await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(userRef);
        const saldoAtual = doc.exists ? (doc.data().saldoMoedas || 0) : 0;
        transaction.set(userRef, { saldoMoedas: saldoAtual + moedas }, { merge: true });
      });

      console.log(`Pagamento ${paymentId} confirmado para usuário ${uid}. Saldo atualizado.`);
      return res.sendStatus(200);
    } catch (error) {
      console.error("Erro ao processar pagamento:", error);
      return res.sendStatus(500);
    }
  }

  // Outros status ignorados
  res.sendStatus(200);
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
