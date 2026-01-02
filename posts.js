// posts.js
// Local blog posts (fallback) used together with Medium RSS posts.

const BLOG_POSTS = [
  {
    id: "introspection-1",
    date: "August 1, 2023",
    title: "Introspection 1 - 寫在飛美國前三週",
    summary:
      "六七月的雜感與情緒整理，記錄在飛往美國念碩士前的心境：道別、收尾、感謝，以及面對未知生活的拉扯。",
    mediumUrl: null,
    contentHtml: `
      <p>This is a personal checkpoint before moving to the U.S.: work, relationships, gratitude, and uncertainty.</p>
      <p>The focus is not “escaping”, but starting a new chapter with a more organized mind.</p>
    `,
  },
  {
    id: "embrace-failure",
    date: "November 27, 2022",
    title: "擁抱失敗並學會放過自己",
    summary:
      "在準備留學考試與申請過程中，長時間卡關、落敗、重考，如何面對焦慮、自我懷疑，最後學會放過自己。",
    mediumUrl:
      "https://jasonroy7dct.medium.com/%E6%93%81%E6%8A%B1%E5%A4%B1%E6%95%97%E4%B8%A6%E5%AD%B8%E6%9C%83%E6%94%BE%E9%81%8E%E8%87%AA%E5%B7%B1-dfdde85744fb",
    contentHtml: `
      <p>This piece reframes “failure” from a score into a direction signal.</p>
      <p><a href="https://jasonroy7dct.medium.com/%E6%93%81%E6%8A%B1%E5%A4%B1%E6%95%97%E4%B8%A6%E5%AD%B8%E6%9C%83%E6%94%BE%E9%81%8E%E8%87%AA%E5%B7%B1-dfdde85744fb" target="_blank" rel="noopener noreferrer">
        Read on Medium →
      </a></p>
    `,
  },
  {
    id: "goodbye-2021-hola-2022",
    date: "January 1, 2022",
    title: "Goodbye 2021, Hola 2022",
    summary:
      "回顧第一份完整工作的年度，和自己設定的職涯與留學里程碑：累積兩三年經驗、申請理想研究所、為下一段人生鋪路。",
    mediumUrl:
      "https://jasonroy7dct.medium.com/goodbye-2021-hola-2022-41d4572968e",
    contentHtml: `
      <p>A year-end letter: closing loops, building runway, and setting milestones.</p>
      <p><a href="https://jasonroy7dct.medium.com/goodbye-2021-hola-2022-41d4572968e" target="_blank" rel="noopener noreferrer">
        Read on Medium →
      </a></p>
    `,
  },
  {
    id: "kindness-and-talent",
    date: "December 1, 2021",
    title: "聰明是種天賦，善良是種選擇啊！",
    summary:
      "從職場一年多的觀察出發，談「聰明」與「善良」的落差，以及在不算天才的前提下，選擇用善良與穩定輸出站穩位置。",
    mediumUrl:
      "https://jasonroy7dct.medium.com/%E8%81%B0%E6%98%8E%E6%98%AF%E7%A8%AE%E5%A4%A9%E8%B3%A6-%E5%96%84%E8%89%AF%E6%98%AF%E7%A8%AE%E9%81%B8%E6%93%87%E5%95%8A-b22781e362d",
    contentHtml: `
      <p>Talent is a gift; kindness is a choice.</p>
      <p><a href="https://jasonroy7dct.medium.com/%E8%81%B0%E6%98%8E%E6%98%AF%E7%A8%AE%E5%A4%A9%E8%B3%A6-%E5%96%84%E8%89%AF%E6%98%AF%E7%A8%AE%E9%81%B8%E6%93%87%E5%95%8A-b22781e362d" target="_blank" rel="noopener noreferrer">
        Read on Medium →
      </a></p>
    `,
  },
  {
    id: "azure-devops-gitflow",
    date: "May 23, 2021",
    title: "Design Azure DevOps CI/CD pipeline with Git Flow",
    summary:
      "Technical write-up: Git Flow + CI/CD pipelines on Azure DevOps and deployments to Windows Server / OpenShift.",
    mediumUrl:
      "https://jasonroy7dct.medium.com/design-azure-devops-ci-cd-pipeline-with-git-flow-b3105a333cce",
    contentHtml: `
      <p>Concrete DevOps experience: branching strategy, build/release pipelines, and deployment constraints.</p>
      <p><a href="https://jasonroy7dct.medium.com/design-azure-devops-ci-cd-pipeline-with-git-flow-b3105a333cce" target="_blank" rel="noopener noreferrer">
        Read on Medium →
      </a></p>
    `,
  },
];
