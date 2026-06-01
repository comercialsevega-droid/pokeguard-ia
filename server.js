import express from "express";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";

dotenv.config();

const app = express();

app.use(express.json({ limit: "25mb" }));
app.use(express.static("public"));

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

app.get("/health", (req, res) => {
  res.json({ status: "online" });
});

app.post("/buscar-cidadao", async (req, res) => {
  try {
    const { rg } = req.body;

    const { data: cidadao, error } = await supabase
      .from("cidadaos")
      .select("*")
      .eq("rg", rg)
      .maybeSingle();

    if (error) throw error;

    if (!cidadao) {
      return res.json({
        encontrado: false,
        cidadao: null,
        prisoes: []
      });
    }

    const { data: prisoes, error: erroPrisoes } = await supabase
      .from("prisoes")
      .select("*")
      .eq("rg", rg)
      .order("created_at", { ascending: false });

    if (erroPrisoes) throw erroPrisoes;

    res.json({
      encontrado: true,
      cidadao,
      prisoes: prisoes || []
    });

  } catch (erro) {
    console.error("ERRO AO BUSCAR CIDADÃO:", erro);
    res.status(500).json({ erro: "Erro ao buscar cidadão." });
  }
});

app.post("/cadastrar-cidadao", async (req, res) => {
  try {
    const { nome, rg, foto_base64 } = req.body;

    if (!nome || !rg) {
      return res.status(400).json({
        erro: "Nome e RG são obrigatórios."
      });
    }

    let foto_url = null;

    const { data: cidadaoExistente } = await supabase
      .from("cidadaos")
      .select("*")
      .eq("rg", rg)
      .maybeSingle();

    if (cidadaoExistente && cidadaoExistente.foto_url) {
      foto_url = cidadaoExistente.foto_url;
    }

    if (foto_base64) {
      const partes = foto_base64.split(",");
      const base64Data = partes[1];

      if (!base64Data) {
        return res.status(400).json({
          erro: "Formato da foto inválido."
        });
      }

      const contentType = foto_base64.split(";")[0].split(":")[1] || "image/png";
      const extensao = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";
      const fileName = `${rg}-${Date.now()}.${extensao}`;

      const buffer = Buffer.from(base64Data, "base64");

      const { error: uploadError } = await supabase.storage
        .from("fotos-cidadaos")
        .upload(fileName, buffer, {
          contentType,
          upsert: true
        });

      if (uploadError) {
        console.error("ERRO UPLOAD FOTO:", uploadError);
        throw uploadError;
      }

      const { data: publicUrlData } = supabase.storage
        .from("fotos-cidadaos")
        .getPublicUrl(fileName);

      foto_url = publicUrlData.publicUrl;
    }

    const { data, error } = await supabase
      .from("cidadaos")
      .upsert(
        {
          nome,
          rg,
          foto_url
        },
        { onConflict: "rg" }
      )
      .select()
      .single();

    if (error) throw error;

    res.json({
      sucesso: true,
      cidadao: data
    });

  } catch (erro) {
    console.error("ERRO AO CADASTRAR CIDADÃO:", erro);
    res.status(500).json({
      erro: "Erro ao cadastrar cidadão. Verifique se o bucket fotos-cidadaos permite upload público."
    });
  }
});

app.post("/salvar-prisao", async (req, res) => {
  try {
    const {
      cidadao_id,
      nome,
      rg,
      relato,
      artigos,
      meses_total,
      multa_total,
      oficial
    } = req.body;

    if (!nome || !rg || !relato || !artigos || artigos.length === 0) {
      return res.status(400).json({
        erro: "Dados insuficientes para salvar a prisão."
      });
    }

    let cidadaoIdFinal = cidadao_id || null;

    if (!cidadaoIdFinal) {
      const { data: cidadaoExistente } = await supabase
        .from("cidadaos")
        .select("*")
        .eq("rg", rg)
        .maybeSingle();

      if (cidadaoExistente) {
        cidadaoIdFinal = cidadaoExistente.id;
      }
    }

    const { data, error } = await supabase
      .from("prisoes")
      .insert({
        cidadao_id: cidadaoIdFinal,
        nome,
        rg,
        relato,
        artigos,
        meses_total,
        multa_total,
        oficial
      })
      .select()
      .single();

    if (error) throw error;

    res.json({
      sucesso: true,
      prisao: data
    });

  } catch (erro) {
    console.error("ERRO AO SALVAR PRISÃO:", erro);
    res.status(500).json({
      erro: "Erro ao salvar prisão."
    });
  }
});

app.post("/analisar", async (req, res) => {
  try {
    const { relato } = req.body;

    if (!relato || relato.trim().length < 5) {
      return res.status(400).json({
        erro: "Digite um relato maior para a IA analisar."
      });
    }

    const prompt = `
Você é a IA Penal oficial da PokéGuard, uma polícia de cidade RP Pokémon.

Sua função é ler o relato da ocorrência, entender o contexto e aplicar TODOS os artigos cabíveis.

REGRAS PRINCIPAIS:
- Aplique múltiplos artigos quando couber.
- Não aplique apenas um artigo se houver vários fatos no relato.
- Entenda linguagem informal, abreviações, erros de escrita e diferentes formas de narrar.
- Use somente os artigos listados abaixo.
- Não invente artigos.
- Resistência à prisão só deve ser aplicada se o suspeito, APÓS perder fuga/batalha ou APÓS receber voz de prisão, recusou a prisão, continuou fugindo ou agrediu.
- Fuga antes de ser contido NÃO é resistência à prisão.
- Batalha antes de ser contido NÃO é resistência à prisão.
- Se houver roubo em casa/residência/propriedade, aplique Roubo + Invasão de Propriedade.
- Se houver uso de Pokémon em crime, fuga, batalha ou confronto contra a PokéGuard, aplique Art. 58.
- Se houver 3 ou mais pessoas cometendo crime, aplique Associação Criminosa.
- Se houver lockpick, item ilegal ou objeto ilegal, aplique Posse de Objetos Ilegais.
- Se houver clonagem, experimento genético, laboratório ilegal ou Pokémon clonado, aplique Clonagem e Experimentação Genética Ilegal.
- Se houver fuga de ordem de parada, perseguição ou tentativa de escapar da abordagem, aplique Fuga de Ordem de Parada.
- Retorne SOMENTE JSON válido, sem texto antes ou depois.

ARTIGOS DISPONÍVEIS:

Art. 8º - Homicídio Doloso - 50 meses - 4500 PokéCoins
Art. 9º - Homicídio Culposo - 40 meses - 4000 PokéCoins
Art. 10º - Homicídio contra Funcionário Público - 60 meses - 10000 PokéCoins
Art. 11º - Tentativa de Homicídio - 20 meses - 3000 PokéCoins
Art. 12º - Agressão Física - 10 meses - 7000 PokéCoins
Art. 13º - Crime de Ódio - 30 meses - 5000 PokéCoins
Art. 14º - Sequestro e Cárcere Privado - 50 meses - 10000 PokéCoins
Art. 15º - Fazer Reféns - 50 meses - 8000 PokéCoins
Art. 17º - Crime de Ameaça - 0 meses - 3000 PokéCoins
Art. 18º - Crime de Ameaça Grave - 10 meses - 2000 PokéCoins
Art. 19º - Furto - 15 meses - 4000 PokéCoins
Art. 20º - Roubo - 20 meses - 5000 PokéCoins
Art. 21º - Tentativa de Furto/Roubo - 20 meses - 3500 PokéCoins
Art. 23º - Receptação - 20 meses - 5500 PokéCoins
Art. 24º - Fraude - 20 meses - 1500 PokéCoins
Art. 25º - Invasão de Propriedade e Privacidade - 15 meses - 2500 PokéCoins
Art. 27º - Alteração de notas ou lavagem de dinheiro - 25 meses - 6500 PokéCoins
Art. 28º - Bater e Fugir - 0 meses - 3000 PokéCoins
Art. 29º - Fuga de Ordem de Parada Imprudente - 15 meses - 3000 PokéCoins
Art. 30º - Trafegar fora da via/local impróprio - 0 meses - 1500 PokéCoins
Art. 31º - Veículo sem condições de uso - 0 meses - 2500 PokéCoins
Art. 32º - Corrida/Racha ilegal - 20 meses - 5000 PokéCoins
Art. 33º - Desacato - 15 meses - 4000 PokéCoins
Art. 34º - Desobediência - 15 meses - 4000 PokéCoins
Art. 35º - Resistência à Prisão sem violência - 15 meses - 2500 PokéCoins
Art. 35º - Resistência à Prisão com violência/agressão - 25 meses - 3000 PokéCoins
Art. 36º - Falsa denúncia - 15 meses - 1500 PokéCoins
Art. 36º - Trote - 25 meses - 2000 PokéCoins
Art. 40º - Obstrução da Justiça - 20 meses - 2500 PokéCoins
Art. 41º - Associação Criminosa - 20 meses - 3000 PokéCoins
Art. 42º - Promover ou Facilitar Fuga - 15 meses - 3000 PokéCoins
Art. 43º - Usurpação de Função - 25 meses - 4000 PokéCoins
Art. 44º - Falsidade Ideológica - 25 meses - 4000 PokéCoins
Art. 45º - Prevaricação - 20 meses - 5000 PokéCoins
Art. 46º - Incitação ao Crime - 20 meses - 2500 PokéCoins
Art. 47º - Abrigar fugitivo - 15 meses - 1500 PokéCoins
Art. 48º - Perturbação do Sossego - 0 meses - 1000 PokéCoins
Art. 49º - Perturbação Sonora - 0 meses - 3000 PokéCoins
Art. 50º - Obstrução Facial - 0 meses - 4500 PokéCoins
Art. 51º - Posse de Objetos Ilegais - 0 meses - 6500 PokéCoins
Art. 52º - Importunação - 15 meses - 3000 PokéCoins
Art. 53º - Estabelecimento Irregular - 0 meses - 5000 PokéCoins
Art. 54º - Batalha Pokémon em Local Proibido - 0 meses - 0 PokéCoins
Art. 55º - Maus-tratos e Crueldade Pokémon - 80 meses - 10000 PokéCoins
Art. 56º - Abandono de Pokémon - 0 meses - 10000 PokéCoins
Art. 57º - Omissão de Cuidados e Negligência Pokémon - 0 meses - 20000 PokéCoins
Art. 58º - Uso de Pokémon para Atividade Criminosa - 20 meses - 3000 PokéCoins
Art. 60º - Captura e Caça Ilegal - 10 meses - 5000 PokéCoins
Art. 61º - Venda de Pokémon - 30 meses - 20000 PokéCoins
Art. 61º - Compra de Pokémon - 20 meses - 10000 PokéCoins
Art. 62º - Contrabando e Tráfico de Itens Raros - 30 meses - 3000 PokéCoins
Art. 63º - Posse de Itens Restritos ou Falsificação - 40 meses - 1200 PokéCoins
Art. 64º - Apostas Ilegais e Rinhas - 50 meses - 8000 PokéCoins
Art. 65º - Clonagem e Experimentação Genética Ilegal - 100 meses - 100000 PokéCoins

FORMATO OBRIGATÓRIO:
{
  "artigos": [
    {
      "artigo": "Art. XX",
      "crime": "Nome do crime",
      "meses": 0,
      "multa": 0,
      "motivo": "Explique claramente por que esse artigo foi aplicado"
    }
  ]
}

RELATO DA OCORRÊNCIA:
${relato}
`;

    const resposta = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        temperature: 0.1,
        responseMimeType: "application/json"
      }
    });

    let textoResposta = resposta.text || "";

    textoResposta = textoResposta
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const resultado = JSON.parse(textoResposta);

    res.json(resultado);

  } catch (erro) {
    console.error("ERRO NA IA:", erro);

    res.status(500).json({
      erro: "Erro ao analisar ocorrência com a IA."
    });
  }
});

app.post("/gerar-pdf", async (req, res) => {
  try {
    const {
      nome,
      rg,
      relato,
      artigos,
      meses_total,
      multa_total
    } = req.body;

    if (!nome || !rg || !relato || !artigos || artigos.length === 0) {
      return res.status(400).json({
        erro: "Dados insuficientes para gerar o PDF."
      });
    }

    const doc = new PDFDocument({
      margin: 40,
      size: "A4"
    });

    const buffers = [];

    doc.on("data", chunk => buffers.push(chunk));

    doc.on("end", () => {
      const pdfData = Buffer.concat(buffers);

      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Prisao-${rg}.pdf"`,
        "Content-Length": pdfData.length
      });

      res.end(pdfData);
    });

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;

    // FUNDO DO PDF
    try {
      const fundoUrl = "https://raw.githubusercontent.com/djonikipper-lab/Penal/c66302107092104ebf236824e0513ad049c64f70/Fundo%20Penal.png";

      const respostaFundo = await fetch(fundoUrl);

      if (respostaFundo.ok) {
        const arrayBuffer = await respostaFundo.arrayBuffer();
        const fundoBuffer = Buffer.from(arrayBuffer);

        doc.image(fundoBuffer, 0, 0, {
          width: pageWidth,
          height: pageHeight
        });
      }
    } catch (erroFundo) {
      console.log("Não foi possível carregar o fundo. PDF será gerado sem fundo.");
    }

    const agora = new Date();

    // Textos menores e sem cabeçalho antigo
    doc.fillColor("black");
    doc.font("Helvetica");

    doc.y = 170;

    doc.fontSize(8);
    doc.text(`Data/Hora da Prisão: ${agora.toLocaleString("pt-BR")}`, 50, doc.y);
    doc.moveDown(0.4);

    doc.text(`Nome do Cidadão: ${nome}`, 50, doc.y);
    doc.moveDown(0.4);

    doc.text(`RG: ${rg}`, 50, doc.y);
    doc.moveDown(1.1);

    doc.fontSize(10).text("PENA FINAL", 50, doc.y);
    doc.moveDown(0.4);

    doc.fontSize(8);
    doc.text(`Total de Meses: ${meses_total}`, 50, doc.y);
    doc.moveDown(0.3);
    doc.text(`Multa Final: ${Number(multa_total).toLocaleString("pt-BR")} PokéCoins`, 50, doc.y);

    doc.moveDown(1);

    doc.fontSize(10).text("ARTIGOS APLICADOS", 50, doc.y);
    doc.moveDown(0.4);

    artigos.forEach((artigo) => {
      if (doc.y > 700) {
        doc.addPage();

        try {
          // Segunda página sem fundo para evitar erro
          doc.fillColor("black");
        } catch {}
      }

      doc.fontSize(7.5);
      doc.text(`${artigo.artigo} - ${artigo.crime}`, 50, doc.y, { width: 500 });
      doc.moveDown(0.2);
      doc.text(`Meses: ${artigo.meses} | Multa: ${Number(artigo.multa).toLocaleString("pt-BR")} PokéCoins`, 50, doc.y, { width: 500 });
      doc.moveDown(0.2);
      doc.text(`Motivo: ${artigo.motivo}`, 50, doc.y, { width: 500 });
      doc.moveDown(0.5);
    });

    doc.moveDown(0.5);

    if (doc.y > 700) {
      doc.addPage();
    }

    doc.fontSize(10).text("RELATO DA OCORRÊNCIA", 50, doc.y);
    doc.moveDown(0.4);

    doc.fontSize(7.5).text(relato, 50, doc.y, {
      align: "justify",
      width: 500
    });

    doc.end();

  } catch (erro) {
    console.error("ERRO AO GERAR PDF:", erro);

    res.status(500).json({
      erro: "Erro ao gerar PDF."
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("PokéGuard IA + Supabase rodando na porta " + PORT);
});
