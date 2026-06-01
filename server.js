import express from "express";
import dotenv from "dotenv";
import Groq from "groq-sdk";
import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";

dotenv.config();

const app = express();

app.use(express.json({ limit: "25mb" }));
app.use(express.static("public"));

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
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
        { nome, rg, foto_url },
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
      erro: "Erro ao cadastrar cidadão. Verifique as permissões do bucket fotos-cidadaos."
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

Sua função NÃO é adivinhar crimes.
Sua função é LER o relato, EXTRAIR fatos claros e aplicar SOMENTE os artigos que possuam evidência direta ou contextual forte.

PROCESSO OBRIGATÓRIO:
1. Leia o relato inteiro.
2. Extraia os fatos concretos narrados.
3. Compare os fatos com os artigos.
4. Aplique apenas artigos que tenham base clara no relato.
5. Não aplique artigo por suposição.
6. Não aplique artigo só porque "poderia ter acontecido".

REGRAS DE SEGURANÇA:
- Se o relato não mencionar um fato, NÃO aplique o artigo.
- Se houver dúvida, NÃO aplique.
- Não invente violência se o relato só fala em fuga.
- Não invente ameaça se o relato só fala em roubo simples.
- Não invente associação criminosa se o relato não indicar 3 ou mais pessoas.
- Não invente resistência à prisão se o relato não indicar recusa APÓS derrota ou APÓS voz de prisão.
- Não aplique desacato sem xingamento, ofensa ou humilhação clara.
- Não aplique agressão sem agressão física clara.
- Não aplique ameaça sem ameaça clara.
- Não aplique uso de Pokémon se o relato não citar Pokémon, batalha, combate Pokémon ou uso de Pokémon.
- Não aplique clonagem se não houver clonagem, experimento genético, laboratório ilegal ou Pokémon clonado.
- Não aplique itens ilegais se não houver lockpick, item ilegal, objeto ilegal ou item restrito.
- Não aplique invasão se não houver casa, residência, propriedade, terreno ou entrada indevida.

REGRAS ESPECÍFICAS:
- Roubo em casa/residência/propriedade = Art. 20 + Art. 25.
- Furto em casa/residência/propriedade = Art. 19 + Art. 25.
- Tentativa de roubo/furto = Art. 21.
- Fuga de ordem de parada/perseguição = Art. 29.
- Uso de Pokémon para fugir, batalhar ou auxiliar crime = Art. 58.
- 3 ou mais pessoas cometendo crime = Art. 41.
- Resistência à prisão:
  Só aplicar se o relato disser que, depois de perder fuga/batalha ou depois da voz de prisão, recusou a prisão, continuou fugindo, tentou escapar ou agrediu.
- Resistência com violência:
  Só aplicar se após voz de prisão/derrota houve agressão, ataque ou violência.
- Resistência sem violência:
  Só aplicar se após voz de prisão/derrota houve recusa, tentativa de fuga ou não aceitou prisão.

  REGRAS DE DIFERENCIAÇÃO IMPORTANTES:
- Drogas, entorpecentes, itens ilícitos, lockpicks, objetos ilegais ou produtos proibidos NÃO são lavagem de dinheiro.
- Drogas ou entorpecentes devem ser tratados como Art. 51 - Posse de Objetos Ilegais, salvo se houver artigo específico sobre drogas.
- Só aplique Art. 27 - Alteração de notas ou lavagem de dinheiro se o relato mencionar claramente dinheiro sujo, notas roubadas, troca de notas, lavagem, dinheiro de origem criminosa ou tentativa de limpar dinheiro.
- Não associe automaticamente "produto ilegal" com lavagem de dinheiro.
- Se o relato disser apenas que a pessoa estava com drogas, substâncias ilegais, itens ilegais ou lockpick, aplique Art. 51.
- Se houver venda/compra de produto criminoso, aplique Art. 23 - Receptação, não lavagem de dinheiro.
- Se houver dinheiro sujo + tentativa de trocar/limpar o dinheiro, aplique Art. 27.

ARTIGOS DISPONÍVEIS:
Art. 8º - Homicídio Doloso - Quando há intenção de matar - 50 meses - 4500 PokéCoins
Art. 9º - Homicídio Culposo - Quando não há intenção de matar - 40 meses - 4000 PokéCoins
Art. 10º - Homicídio contra Funcionário Público - Contra Hospital, Neospark ou PokéGuard - 60 meses - 10000 PokéCoins
Art. 11º - Tentativa de Homicídio - Tentou matar alguém - 20 meses - 3000 PokéCoins
Art. 12º - Agressão Física - Agressão corporal sem intenção de matar - 10 meses - 7000 PokéCoins
Art. 13º - Crime de Ódio - Preconceito ou aversão - 30 meses - 5000 PokéCoins
Art. 14º - Sequestro e Cárcere Privado - Impedir liberdade de ir e vir - 50 meses - 10000 PokéCoins
Art. 15º - Fazer Reféns - Reter alguém como garantia - 50 meses - 8000 PokéCoins
Art. 17º - Crime de Ameaça - Ameaçar outro de crime - 0 meses - 3000 PokéCoins
Art. 18º - Crime de Ameaça Grave - Ameaça grave ou reincidência - 10 meses - 2000 PokéCoins
Art. 19º - Furto - Subtração sem violência ou ameaça - 15 meses - 4000 PokéCoins
Art. 20º - Roubo - Subtração com violência ou ameaça - 20 meses - 5000 PokéCoins
Art. 21º - Tentativa de Furto/Roubo - Tentativa de furtar ou roubar - 20 meses - 3500 PokéCoins
Art. 23º - Receptação - Produto de origem criminosa - 20 meses - 5500 PokéCoins
Art. 24º - Fraude - Enganar para obter ganho ilícito - 20 meses - 1500 PokéCoins
Art. 25º - Invasão de Propriedade e Privacidade - Entrar em terreno alheio, casa ou privacidade - 15 meses - 2500 PokéCoins
Art. 27º - Alteração de notas ou lavagem de dinheiro - SOMENTE quando houver troca de notas roubadas, dinheiro sujo, lavagem ou tentativa de limpar dinheiro de origem criminosa - 25 meses - 6500 PokéCoins
Art. 28º - Bater e Fugir - Fugir após colisão - 0 meses - 3000 PokéCoins
Art. 29º - Fuga de Ordem de Parada Imprudente - Fugir de ordem de parada, perseguição ou manobra perigosa - 15 meses - 3000 PokéCoins
Art. 30º - Trafegar fora da via/local impróprio - 0 meses - 1500 PokéCoins
Art. 31º - Veículo sem condições de uso - 0 meses - 2500 PokéCoins
Art. 32º - Corrida/Racha ilegal - 20 meses - 5000 PokéCoins
Art. 33º - Desacato - Desrespeitar ou humilhar funcionário público - 15 meses - 4000 PokéCoins
Art. 34º - Desobediência - Desobedecer ordem direta - 15 meses - 4000 PokéCoins
Art. 35º - Resistência à Prisão sem violência - Recusar prisão após detido, sem violência - 15 meses - 2500 PokéCoins
Art. 35º - Resistência à Prisão com violência/agressão - Recusar prisão após detido, com violência - 25 meses - 3000 PokéCoins
Art. 36º - Falsa denúncia - 15 meses - 1500 PokéCoins
Art. 36º - Trote - 25 meses - 2000 PokéCoins
Art. 40º - Obstrução da Justiça - Esconder/destruir provas ou atrapalhar polícia - 20 meses - 2500 PokéCoins
Art. 41º - Associação Criminosa - 3 ou mais pessoas para cometer crimes - 20 meses - 3000 PokéCoins
Art. 42º - Promover ou Facilitar Fuga - Ajudar fugitivo a escapar - 15 meses - 3000 PokéCoins
Art. 43º - Usurpação de Função - Se passar por oficial - 25 meses - 4000 PokéCoins
Art. 44º - Falsidade Ideológica - Falsa identidade - 25 meses - 4000 PokéCoins
Art. 45º - Prevaricação - 20 meses - 5000 PokéCoins
Art. 46º - Incitação ao Crime - Estimular crime publicamente - 20 meses - 2500 PokéCoins
Art. 47º - Abrigar fugitivo - Esconder fugitivo - 15 meses - 1500 PokéCoins
Art. 48º - Perturbação do Sossego - Barulho incômodo - 0 meses - 1000 PokéCoins
Art. 49º - Perturbação Sonora - Som alto em local proibido - 0 meses - 3000 PokéCoins
Art. 50º - Obstrução Facial - Máscara que impede identificação - 0 meses - 4500 PokéCoins
Art. 51º - Posse de Objetos Ilegais - Portar lockpick, drogas, entorpecentes, substâncias ilegais, item ilegal, objeto ilegal ou qualquer item proibido - 0 meses - 6500 PokéCoins
Art. 52º - Importunação - Comportamento impróprio persistente - 15 meses - 3000 PokéCoins
Art. 53º - Estabelecimento Irregular - Sem registro ou higiene - 0 meses - 5000 PokéCoins
Art. 54º - Batalha Pokémon em Local Proibido - Batalha em local proibido - 0 meses - 0 PokéCoins
Art. 55º - Maus-tratos e Crueldade Pokémon - Forçar batalhas até exaustão ou crueldade - 80 meses - 10000 PokéCoins
Art. 56º - Abandono de Pokémon - 0 meses - 10000 PokéCoins
Art. 57º - Omissão de Cuidados e Negligência Pokémon - 0 meses - 20000 PokéCoins
Art. 58º - Uso de Pokémon para Atividade Criminosa - Pokémon auxiliando crime, furto, fuga, dano ou batalha contra PokéGuard - 20 meses - 3000 PokéCoins
Art. 60º - Captura e Caça Ilegal - Captura em área proibida - 10 meses - 5000 PokéCoins
Art. 61º - Venda de Pokémon - 30 meses - 20000 PokéCoins
Art. 61º - Compra de Pokémon - 20 meses - 10000 PokéCoins
Art. 62º - Contrabando e Tráfico de Itens Raros - 30 meses - 3000 PokéCoins
Art. 63º - Posse de Itens Restritos ou Falsificação - Master Ball sem registro, item tático ou falsificado - 40 meses - 1200 PokéCoins
Art. 64º - Apostas Ilegais e Rinhas - Aposta ou rinha em batalha não oficial - 50 meses - 8000 PokéCoins
Art. 65º - Clonagem e Experimentação Genética Ilegal - Clonagem, experimento genético ou Pokémon clonado - 100 meses - 100000 PokéCoins

FORMATO OBRIGATÓRIO:
Retorne SOMENTE este JSON:

{
  "fatos_identificados": [
    "fato 1",
    "fato 2"
  ],
  "artigos": [
    {
      "artigo": "Art. XX",
      "crime": "Nome do crime",
      "meses": 0,
      "multa": 0,
      "motivo": "Explique qual trecho/fato do relato justifica este artigo"
    }
  ]
}

RELATO:
${relato}
`;

    const resposta = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: "Você responde somente JSON válido, sem markdown."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0,
      response_format: { type: "json_object" }
    });

    const textoResposta = resposta.choices[0].message.content;
    const resultado = JSON.parse(textoResposta);
    resultado.artigos = validarArtigosComRelato(relato, resultado.artigos || []);

    res.json(resultado);

  } catch (erro) {
    console.error("ERRO NA IA GROQ:", erro);

    res.status(500).json({
      erro: "Erro ao analisar ocorrência com a IA Groq."
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
      multa_total,
      foto_url
    } = req.body;

    if (!nome || !rg || !relato || !artigos || artigos.length === 0) {
      return res.status(400).json({
        erro: "Dados insuficientes para gerar o PDF."
      });
    }

    const doc = new PDFDocument({ margin: 40, size: "A4" });
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
    } catch {
      console.log("Fundo não carregado.");
    }

    const agora = new Date();

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

    doc.addPage();
    doc.fontSize(14).text("FOTO DO SUSPEITO", { align: "center" });

    if (foto_url) {
      try {
        const fotoResponse = await fetch(foto_url);
        if (fotoResponse.ok) {
          const fotoArrayBuffer = await fotoResponse.arrayBuffer();
          const fotoBuffer = Buffer.from(fotoArrayBuffer);

          doc.moveDown(2);
          doc.image(fotoBuffer, 180, 140, {
            width: 240,
            height: 300
          });
        } else {
          doc.moveDown(2).fontSize(10).text("Foto não disponível.", { align: "center" });
        }
      } catch {
        doc.moveDown(2).fontSize(10).text("Erro ao carregar foto do suspeito.", { align: "center" });
      }
    } else {
      doc.moveDown(2).fontSize(10).text("Nenhuma foto cadastrada.", { align: "center" });
    }

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
  console.log("PokéGuard IA + Supabase + Groq rodando na porta " + PORT);
});
