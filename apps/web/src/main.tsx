import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import ProjectsHome from './pages/ProjectsHome';
import Editor from './editor/Editor';
import { ToastHost } from './components/ui';
import './index.css';

const router = createBrowserRouter([
  { path: '/', element: <ProjectsHome /> },
  { path: '/editor/:sequenceId', element: <Editor /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
    <ToastHost />
  </React.StrictMode>,
);
