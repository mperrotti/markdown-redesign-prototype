import React, { useEffect, useState } from "react";
import Doc from "./Doc";
import "./base.scss";
import * as marked from "marked";

interface AppData {
  currentDoc: string;
  docs: { id: string; title: string | false; lastModified: Date }[];
  revision: number;
  signUpDate: Date;
}

// TODO: strip more of this out
const DocContainer: React.FC = () => {
  const [appData, setAppData] = useState<AppData | null>(null);
  const [sampleMarkdownDocText, setsampleMarkdownDocText] =
    useState<string>("");

  useEffect(() => {
    marked.setOptions({
      breaks: true,
    });
    const currentDoc = "currentDoc";
    const defaultAppData: AppData = {
      currentDoc,
      docs: [{ id: currentDoc, title: false, lastModified: new Date() }],
      revision: 0,
      signUpDate: new Date(),
    };
    setAppData(defaultAppData);
    (async () => {
      const resp = await fetch(
        new URL("./sampleMarkdownDoc.md", import.meta.url)
      );
      const text = await resp.text();
      setsampleMarkdownDocText(text);
    })();
  }, []);

  return (
    <div>
      {appData?.currentDoc && (
        <Doc key={appData.currentDoc} initialData={sampleMarkdownDocText} />
      )}
    </div>
  );
};

export default DocContainer;
