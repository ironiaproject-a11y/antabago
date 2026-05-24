(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RespiraMilestones = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const MILESTONES = [
    {
      id: 'm20min',
      label: '20 minutos',
      minutes: 20,
      title: 'Primeiro ajuste do seu corpo',
      body: 'Seu ritmo cardiaco e sua pressao arterial ja comecam a voltar para um padrao mais saudavel. O sistema cardiovascular responde rapido quando a nicotina para de entrar. Seu corpo ja percebe que voce esta se protegendo.',
      icon: '❤️',
      category: 'cardiovascular'
    },
    {
      id: 'm8h',
      label: '8 horas',
      minutes: 480,
      title: 'Sangue mais oxigenado',
      body: 'O monoxido de carbono no sangue cai de forma importante e o oxigenio volta a circular melhor. Isso melhora a entrega de energia para celulas e tecidos. Seu corpo inteiro respira com mais eficiencia.',
      icon: '🩸',
      category: 'cardiovascular'
    },
    {
      id: 'm24h',
      label: '24 horas',
      minutes: 1440,
      title: 'Coracao mais protegido',
      body: 'Apos um dia sem fumar, o risco de infarto ja comeca a cair. Inflamacao e sobrecarga vascular diminuem desde cedo. Cada hora sem cigarro reforca essa protecao.',
      icon: '🫀',
      category: 'cardiovascular'
    },
    {
      id: 'm48h',
      label: '48 horas',
      minutes: 2880,
      title: 'Sentidos acordando de novo',
      body: 'Terminacoes nervosas iniciam regeneracao e olfato e paladar voltam a ficar mais vivos. O cerebro comeca a recalibrar recompensas sem nicotina. Voce sente sabores e cheiros com outra intensidade.',
      icon: '👅',
      category: 'neurologico'
    },
    {
      id: 'm72h',
      label: '72 horas',
      minutes: 4320,
      title: 'Pulmoes ganhando espaco',
      body: 'Bronquios relaxam e o ar passa com menos resistencia. A respiracao tende a ficar menos pesada em esforcos do dia a dia. E um marco importante para seu sistema respiratorio.',
      icon: '🫁',
      category: 'respiratorio'
    },
    {
      id: 'm1w',
      label: '1 semana',
      minutes: 10080,
      title: 'Circulacao em alta',
      body: 'A microcirculacao periferica melhora de forma perceptivel, inclusive em extremidades. O fluxo sanguineo fica mais eficiente para nutrir tecidos. Seu corpo entra em modo de recuperacao acelerada.',
      icon: '✨',
      category: 'cardiovascular'
    },
    {
      id: 'm2w',
      label: '2 semanas',
      minutes: 20160,
      title: 'Folego subindo',
      body: 'A funcao pulmonar pode melhorar ate cerca de 30% nas primeiras semanas. Atividades simples tendem a cansar menos. Seu pulmão ja trabalha com mais liberdade.',
      icon: '💨',
      category: 'respiratorio'
    },
    {
      id: 'm1m',
      label: '1 mes',
      minutes: 43200,
      title: 'Respirar fica mais leve',
      body: 'Tosse e falta de ar costumam reduzir significativamente no primeiro mes. A via aerea inflamada vai se acalmando. O cotidiano fica mais confortavel para o seu peito.',
      icon: '🌬️',
      category: 'respiratorio'
    },
    {
      id: 'm3m',
      label: '3 meses',
      minutes: 129600,
      title: 'Limpeza pulmonar ativa',
      body: 'Os cilios pulmonares recuperam funcao de forma robusta e ajudam a limpar impurezas. Isso reduz acumulacao de muco e melhora defesa local. Seu sistema respiratorio fica mais resiliente.',
      icon: '🧼',
      category: 'celular'
    },
    {
      id: 'm6m',
      label: '6 meses',
      minutes: 259200,
      title: 'Menos crises respiratorias',
      body: 'Episodios de bronquite e irritacao respiratoria tendem a reduzir com consistencia. O tecido pulmonar continua em reparo continuo. Seu corpo consolida ganhos de medio prazo.',
      icon: '🛡️',
      category: 'respiratorio'
    },
    {
      id: 'm1y',
      label: '1 ano',
      minutes: 525600,
      title: 'Risco coronariano pela metade',
      body: 'Em um ano, o risco de doenca coronariana cai aproximadamente 50% em relacao a quem continua fumando. O sistema cardiovascular responde com ganhos profundos. Esse e um marco gigante.',
      icon: '🏆',
      category: 'cardiovascular'
    },
    {
      id: 'm5y',
      label: '5 anos',
      minutes: 2628000,
      title: 'AVC em patamar de nao fumante',
      body: 'Com cerca de cinco anos, o risco de AVC pode se aproximar do de uma pessoa nao fumante. A recuperacao vascular de longo prazo e real. Seu cuidado diario muda sua historia clinica.',
      icon: '🧠',
      category: 'neurologico'
    },
    {
      id: 'm10y',
      label: '10 anos',
      minutes: 5256000,
      title: 'Risco de cancer de pulmao reduzido',
      body: 'Em torno de dez anos, o risco de cancer de pulmao cai pela metade em comparacao com quem segue fumando. O beneficio se estende para varios tumores relacionados ao tabaco. E ciencia a seu favor.',
      icon: '🔬',
      category: 'celular'
    },
    {
      id: 'm15y',
      label: '15 anos',
      minutes: 7884000,
      title: 'Coracao em nivel de nunca fumante',
      body: 'Por volta de quinze anos, o risco cardiovascular pode se equiparar ao de quem nunca fumou. Essa e uma recuperacao estrutural impressionante. Sua persistencia literalmente reescreveu seu prognostico.',
      icon: '🌟',
      category: 'cardiovascular'
    }
  ];

  function toMinutes(value) {
    return Math.max(0, Math.floor(value));
  }

  function getMinutesSinceQuit(quitDate, now) {
    const quitMs = quitDate instanceof Date ? quitDate.getTime() : new Date(quitDate).getTime();
    const nowMs = now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : Date.now());
    if (!Number.isFinite(quitMs) || !Number.isFinite(nowMs)) return 0;
    return toMinutes((nowMs - quitMs) / 60000);
  }

  function calculateMilestones(quitDate, now) {
    const minutesSinceQuit = getMinutesSinceQuit(quitDate, now);
    const achievedAsc = MILESTONES.filter(m => minutesSinceQuit >= m.minutes);
    const achieved = achievedAsc.slice().reverse();
    const next = MILESTONES.find(m => minutesSinceQuit < m.minutes) || null;

    let nextProgress = 100;
    if (next) {
      const prev = achievedAsc.length ? achievedAsc[achievedAsc.length - 1] : null;
      const prevMinutes = prev ? prev.minutes : 0;
      const span = Math.max(1, next.minutes - prevMinutes);
      nextProgress = Math.max(0, Math.min(100, ((minutesSinceQuit - prevMinutes) / span) * 100));
    }

    return {
      achieved,
      next,
      nextProgress: Math.round(nextProgress),
      minutesSinceQuit
    };
  }

  function useMilestones(quitDate) {
    return calculateMilestones(quitDate, Date.now());
  }

  return {
    MILESTONES,
    getMinutesSinceQuit,
    calculateMilestones,
    useMilestones
  };
});
