const express = require("express");

const app = express();
app.use(express.json());

const PAYEVO_SECRET = "SUA_CHAVE_AQUI";

app.post("/api/criar-pix", async (req, res) => {
  try {
    const { nome, email, cpf, valor, produto } = req.body;

    const payload = {
      amount: Math.round(Number(valor) * 100),
      paymentMethod: "PIX",
      description: produto || "Pedido",
      postbackUrl: "https://seudominio.com/webhook",
      customer: {
        name: nome,
        email: email,
        document: {
          type: "CPF",
          number: cpf
        }
      },
      items: [
        {
          title: produto || "Pedido",
          unitPrice: Math.round(Number(valor) * 100),
          quantity: 1,
          externalRef: "pedido-001"
        }
      ]
    };

    const auth = Buffer.from(PAYEVO_SECRET).toString("base64");

    const response = await fetch("https://apiv2.payevo.com.br/functions/v1/transactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${auth}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error(error);
    res.status(500).json({
      erro: "Erro ao criar PIX",
      detalhe: error.message
    });
  }
});

app.listen(3000, () => {
  console.log("Servidor rodando em http://localhost:3000");
});