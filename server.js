const express = require("express");
const cors = require("cors");
const mercadopago = require("mercadopago");
const { db, admin } = require("./firebaseConfig");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// Configure o seu Access Token do Mercado Pago
mercadopago.configure({
  access_token: process.env.MERCADO_PAGO_ACCESS_TOKEN,
});

app.post("/criar-pagamento", async (req, res) => {
  const { uid, moedas, preco } = req.body;

  if (!uid || !moedas || !preco) {
    return res.status(400).json({ error: "Dados incompletos." });
  }

  try {
    // Cria um pagamento Pix
    const payment = await mercadopago.payment.create({
      transaction_amount: Number(preco),
      description: `${moedas} moedas`,
      payment_method_id: "pix",
      payer: {
        email: `${uid}@temp.com`,
        first_name: "Usuário",
        last_name: "WSAPet",
      },
    });

    const { id, point_of_interaction } = payment.body;

    // Salva no Firestore com status "pendente"
    await db.collection("compras").doc(id.toString()).set({
      uid,
      moedas,
      preco,
      status: "pendente",
      criado_em: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      id,
      copia_cola: point_of_interaction.transaction_data.qr_code,
      qr_code_base64: point_of_interaction.transaction_data.qr_code_base64,
    });
  } catch (error) {
    console.error("Erro ao criar pagamento:", error);
    res.status(500).json({ error: "Erro ao criar pagamento." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
